// ==============================================
// my-advisor-house.js — "บ้านของฉัน" for an อาจารย์, on /me.
//
// REQUESTED (owner, 2026-11-01): "when อาจารย์ login they should see people in
// their บ้าน with UI custom for อาจารย์", and on what they see: "full
// information, it's ok".
//
// ONE SOURCE: public.my_advisor_house() (0272). It takes no argument — identity
// is auth.uid() → users.email → advisors.email — so this module cannot be
// pointed at another อาจารย์'s บ้าน, and it returns null for everyone who is not
// one. No phone numbers: อาจารย์ phones (0243) stay house-admin + master only.
//
// THE GROUPING IS NOT RESTATED. advisor-roster.js is the same pure module the
// admin ระบบบ้าน view uses (สาย → นักศึกษา, youngest first), so the อาจารย์ and
// the admin see one บ้าน in one order.
//
// ⚠️ advisors.email was empty for all 125 on 2026-11-01: until a house admin
// fills it in, no อาจารย์ is recognised and this paints nothing.
// ==============================================
import { escHtml } from '../utils.js';
import { dbRest } from '../db.js';
import { registerProfileCache } from '../profile-cache.js';
import {
  advisorRoster, houseRoster, advisorSaiCodes, yearKey, yearText, YEAR_GRAD,
} from './advisor-roster.js';

let cacheUid = null;
let cachePromise = null;
registerProfileCache(() => { cacheUid = null; cachePromise = null; });

export function clearMyAdvisorHouseCache() {
  cacheUid = null;
  cachePromise = null;
}

/** The caller's บ้าน as an อาจารย์, or null (not one, or the lookup failed —
 *  failing quiet, because every non-อาจารย์ gets null here too). */
export function loadMyAdvisorHouse(uid) {
  if (!uid) return Promise.resolve(null);
  if (cacheUid === uid && cachePromise) return cachePromise;
  cacheUid = uid;
  cachePromise = dbRest('/rpc/my_advisor_house', { method: 'POST', body: {} })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data && data.advisor ? data : null;
    })
    .catch((err) => {
      console.warn('my-advisor-house: lookup failed:', err?.message || err);
      return null;
    });
  return cachePromise;
}

/** Everything the screen needs, derived from the payload — pure, so the test
 *  can pin it without a DOM. */
export function advisorHouseModel(data, { scope = 'mine', q = '', showGrad = false } = {}, now = new Date()) {
  if (!data?.advisor) return null;
  const advisors = data.advisors || [];
  // The payload's `advisor` is the identity; their สาย are on their row in
  // `advisors` (an อาจารย์ with two rows — same email twice — holds both).
  const ids = new Set(data.advisor_ids || [data.advisor.id]);
  const me = {
    ...data.advisor,
    sai_advisors: advisors.filter((a) => ids.has(a.id)).flatMap((a) => a.sai_advisors || []),
  };
  const houseOf = new Map((data.sais || []).map((s) => [s.code, s.house_id]));
  const houseOfSai = (code) => (houseOf.has(code) ? houseOf.get(code) : null);
  const students = data.students || [];
  const isGrad = (s) => yearKey(s, now) === YEAR_GRAD;
  const needle = String(q || '').trim().toLowerCase();
  const pool = students.filter((s) => {
    if (!showGrad && isGrad(s)) return false;
    if (!needle) return true;
    return [s.full_name, s.nickname, s.student_id, s.kkumail, s.sai_code]
      .some((v) => String(v || '').toLowerCase().includes(needle));
  });
  // houseRoster lists the บ้าน's สาย from the students AND the อาจารย์ given,
  // so `me` goes in too — a สาย of mine with nobody in it is still mine.
  const everyone = [me, ...advisors.filter((a) => !ids.has(a.id))];
  const roster = scope === 'house'
    ? houseRoster(me, everyone, pool, houseOfSai, 'sai', now, students)
    : advisorRoster(me, pool, 'sai', now);
  const count = (r) => r.groups.reduce((n, g) => n + g.students.filter((s) => !isGrad(s)).length, 0);
  return {
    me,
    houses: data.houses || [],
    mineCodes: advisorSaiCodes(me),
    roster,
    mineN: count(advisorRoster(me, students, 'sai', now)),
    houseN: count(houseRoster(me, everyone, students, houseOfSai, 'sai', now, students)),
    gradN: students.filter(isGrad).length,
    // Who else looks after each สาย, for the ทั้งบ้าน headings.
    ownersBySai: advisors.reduce((m, a) => {
      for (const l of a.sai_advisors || []) {
        if (!m.has(l.sai_code)) m.set(l.sai_code, []);
        m.get(l.sai_code).push(a.full_name);
      }
      return m;
    }, new Map()),
  };
}

// ── render ─────────────────────────────────────────────────────────────────

const state = { scope: 'mine', q: '', showGrad: false, open: null };
let lastData = null;

function safeColor(c) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : 'var(--brand-primary)';
}

function detailHtml(s) {
  const rows = [
    ['ชื่อ-สกุล', s.full_name],
    ['ชื่อเล่น', s.nickname],
    ['รหัสนักศึกษา', s.student_id],
    ['ชั้นปี', yearText(s)],
    ['สาขา', s.major],
    ['สายรหัส', s.sai_code],
  ].filter(([, v]) => String(v ?? '').trim());
  const mail = String(s.kkumail || '').trim();
  return `
    <div class="madv-detail">
      <dl class="madv-dl">
        ${rows.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${escHtml(String(v))}</dd></div>`).join('')}
        ${mail ? `<div class="is-wide"><dt>อีเมล</dt><dd><a href="mailto:${escHtml(mail)}">${escHtml(mail)}</a></dd></div>` : ''}
        ${String(s.bio || '').trim() ? `<div class="is-wide"><dt>แนะนำตัว</dt><dd>${escHtml(s.bio)}</dd></div>` : ''}
      </dl>
      ${s.has_account ? '' : '<p class="madv-note">ยังไม่เคยเข้าสู่ระบบเว็บสโม</p>'}
    </div>`;
}

function rowHtml(s) {
  const open = state.open === s.id;
  const name = s.full_name ? escHtml(s.full_name) : '<span class="madv-muted">ยังไม่มีชื่อ</span>';
  return `
    <li class="madv-item${open ? ' is-open' : ''}">
      <button type="button" class="madv-row" data-madv-student="${escHtml(s.id)}" aria-expanded="${open}">
        <span class="madv-year">${escHtml(yearText(s))}</span>
        <span class="madv-main">
          <span class="madv-name">${name}${s.nickname ? ` <span class="madv-nick">(${escHtml(s.nickname)})</span>` : ''}</span>
          <span class="madv-sub">${[s.student_id, s.major].filter(Boolean).map(escHtml).join(' · ')}</span>
        </span>
        <i class="bi bi-chevron-${open ? 'up' : 'down'} madv-chev" aria-hidden="true"></i>
      </button>
      ${open ? detailHtml(s) : ''}
    </li>`;
}

function paint(host) {
  const m = advisorHouseModel(lastData, state);
  if (!m) { host.hidden = true; host.innerHTML = ''; return; }
  const house = m.houses[0];
  const inHouse = state.scope === 'house';
  const groups = inHouse && state.q ? m.roster.groups.filter((g) => g.students.length) : m.roster.groups;

  host.hidden = false;
  host.innerHTML = `
    <div class="myseat-card madv-card" style="--house-accent:${escHtml(safeColor(house?.color))}">
      <div class="madv-hero">
        <div>
          <p class="madv-eyebrow"><i class="bi bi-house-heart" aria-hidden="true"></i> อาจารย์ประจำบ้าน</p>
          <h2 class="madv-title">${m.houses.map((h) => escHtml(h.name || `บ้าน ${h.id}`)).join(' · ') || 'บ้านของฉัน'}</h2>
          <p class="madv-stats">
            <strong>${m.mineN.toLocaleString('th-TH')}</strong> นักศึกษาในสายที่ดูแล ·
            สาย ${m.mineCodes.map(escHtml).join(', ') || '—'}
          </p>
        </div>
      </div>

      ${m.mineCodes.length ? `
      <div class="madv-controls">
        <div class="madv-seg" role="radiogroup" aria-label="แสดง">
          <button type="button" role="radio" aria-checked="${!inHouse}" data-madv-scope="mine">
            สายที่ดูแล (${m.mineN.toLocaleString('th-TH')})</button>
          <button type="button" role="radio" aria-checked="${inHouse}" data-madv-scope="house">
            ทั้งบ้าน (${m.houseN.toLocaleString('th-TH')})</button>
        </div>
        <input type="search" class="form-control form-control-sm madv-search" data-madv-search
          placeholder="ค้นหาชื่อ ชื่อเล่น รหัส หรือสาย" value="${escHtml(state.q)}" aria-label="ค้นหานักศึกษา" />
        ${m.gradN ? `
        <label class="madv-grad">
          <input type="checkbox" data-madv-grad ${state.showGrad ? 'checked' : ''} />
          แสดงผู้ที่จบแล้ว (${m.gradN} คน)
        </label>` : ''}
      </div>` : ''}

      <div class="madv-groups">
        ${!m.mineCodes.length
    ? '<p class="madv-empty">ยังไม่มีสายที่อยู่ในความดูแล — แจ้งผู้ดูแลระบบบ้านเพื่อเพิ่มสายของท่าน</p>'
    : groups.length ? groups.map((g) => {
      const owners = inHouse ? (m.ownersBySai.get(g.key) || []) : [];
      const mine = m.mineCodes.includes(g.key);
      return `
          <section class="madv-group${mine && inHouse ? ' is-mine' : ''}">
            <header class="madv-group-head">
              <span class="madv-group-title">สาย ${escHtml(g.key)}</span>
              ${owners.length ? `<span class="madv-owners">${owners.map(escHtml).join(', ')}</span>` : ''}
              <span class="madv-group-count">${g.students.length} คน</span>
            </header>
            ${g.students.length
    ? `<ul class="madv-list">${g.students.map(rowHtml).join('')}</ul>`
    : `<p class="madv-row-empty">${state.q ? 'ไม่มีใครในสายนี้ที่ตรงกับคำค้น' : 'ยังไม่มีนักศึกษาในสายนี้'}</p>`}
          </section>`;
    }).join('')
      : `<p class="madv-empty">ไม่พบนักศึกษาที่ตรงกับ “${escHtml(state.q)}”</p>`}
      </div>
    </div>`;
}

function wire(host) {
  if (host.dataset.madvWired) return;
  host.dataset.madvWired = '1';
  host.addEventListener('click', (e) => {
    const scope = e.target.closest('[data-madv-scope]');
    if (scope) { state.scope = scope.dataset.madvScope; state.open = null; paint(host); return; }
    const row = e.target.closest('[data-madv-student]');
    if (row) {
      const id = row.dataset.madvStudent;
      state.open = state.open === id ? null : id;
      paint(host);
      host.querySelector(`[data-madv-student="${CSS.escape(id)}"]`)?.focus();
    }
  });
  host.addEventListener('change', (e) => {
    if (e.target.matches('[data-madv-grad]')) { state.showGrad = e.target.checked; paint(host); }
  });
  let t = null;
  host.addEventListener('input', (e) => {
    if (!e.target.matches('[data-madv-search]')) return;
    clearTimeout(t);
    const value = e.target.value;
    t = setTimeout(() => {
      state.q = value;
      paint(host);
      // The box was just rebuilt; keep the caret where the person is typing.
      const box = host.querySelector('[data-madv-search]');
      if (box) { box.focus(); box.setSelectionRange(value.length, value.length); }
    }, 160);
  });
}

/** Paint `data` (from loadMyAdvisorHouse) into `host`; null hides it. */
export function renderMyAdvisorHouse(host, data) {
  if (!host) return;
  if (data !== lastData) { state.open = null; }
  lastData = data;
  if (!data) { host.hidden = true; host.innerHTML = ''; return; }
  wire(host);
  paint(host);
}
