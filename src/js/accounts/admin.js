// ==============================================
// บัญชีผู้ใช้ — the account dashboard in /admin/ (0211), `master` only.
//
// Owner, 2026-10-12: see every account on the database — how it signs in,
// which email, which other systems it is in — with clear charts, the detail
// behind each number, live updates, and a screen for anomalies and bugs.
//
// LIVE: the page polls account_dashboard_pulse() (a fingerprint, ~10 ms) every
// 15 s while the pane is on screen, and re-reads the whole dashboard only when
// the fingerprint moves. There is no realtime feed on auth.users, and
// public.users is self-only under RLS (0147), so a realtime channel would
// deliver nothing about anyone else — polling the fingerprint is the honest
// mechanism, and the strip says when it last checked.
//
// Every number on the page comes from summarize()/runChecks() in checks.js;
// nothing here re-decides what a row means. Loaded with a dynamic import on
// first entry (admin-main.js); nothing of it is in the admin entry bundle.
// ==============================================

import { dbRest } from '../db.js';
import { holdsMaster, getUser } from '../auth.js';
import { escHtml, copyText, csvGuard } from '../utils.js';
import { ago } from '../discord-bot-admin.js';
import { PERM_LABEL } from '../team-vocab.js';
import { cohortLabel, studyYearLabel } from '../study-year.js';
import {
  SIGNIN, DOMAINS, SYSTEMS, RECENCY, SEVERITY, SORTS,
  signinOf, domainOf, systemsOf, grantsOf, recencyOf, summarize, runChecks,
  issuesById, activity, filterAccounts, sortAccounts,
} from './checks.js';

const POLL_MS = 15000;
const PAGE = 50;
const SLOT = ['var(--acct-c1)', 'var(--acct-c2)', 'var(--acct-c3)', 'var(--acct-c4)', 'var(--acct-c5)'];
/** Fixed colour per entity, never per rank (a filter must not repaint). */
const SIGNIN_COLOR = { google: SLOT[0], both: SLOT[2], password: SLOT[1], none: 'var(--acct-bug)' };
const DOMAIN_COLOR = { kkumail: SLOT[0], kku: SLOT[2], gmail: SLOT[1], synthetic: SLOT[3], other: SLOT[4] };
const FILTER_LABEL = {
  signin: (v) => SIGNIN.find((x) => x.key === v)?.label,
  domain: (v) => DOMAINS.find((x) => x.key === v)?.label,
  system: (v) => SYSTEMS.find((x) => x.key === v)?.label,
  recency: (v) => (v === 'never' ? 'ไม่เคยเข้า' : `เข้าล่าสุด: ${RECENCY.find((x) => x.key === v)?.label}`),
  check: (v) => checks.find((c) => c.id === v)?.title,
};

const $ = (id) => document.getElementById(id);
let data = null;
let sum = null;
let checks = [];
let issues = new Map();
let byId = new Map();
let filters = {};
let sortKey = 'signin';
let shown = PAGE;
let pulseV = null;
let checkedAt = 0;
let fresh = new Set();
let wired = false;
let timer = null;
let ticker = null;
let loading = false;
let failed = false;

const fmt = (n) => Number(n || 0).toLocaleString('th-TH');
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const thDate = (iso) => (iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
const thDateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');

async function rpc(name) {
  const { data: d, error } = await dbRest(`/rpc/${name}`, { method: 'POST', body: {}, timeout: 30000 });
  if (error) throw new Error(error.status === 403 || /42501|ไม่มีสิทธิ์/.test(`${error.code} ${error.message}`)
    ? 'บัญชีนี้ไม่มีสิทธิ์ดูบัญชีผู้ใช้ทั้งหมด (ต้องมีสิทธิ์ Master ในทีม SAMO)'
    : (error.message || `HTTP ${error.status}`));
  return d;
}

function say(text, tone = 'muted') {
  const el = $('acctMsg');
  if (!el) return;
  el.className = `small mt-2 text-${tone === 'error' ? 'danger' : 'muted'}`;
  el.textContent = text;
}

/** Who a row is, for a human: the registry name, else the account's own. */
function whoName(a) {
  return a.p?.n || a.n || a.u || (a.e || '').split('@')[0] || 'ไม่มีชื่อ';
}
function whoSub(a) {
  const synthetic = domainOf(a.e) === 'synthetic';
  const bits = [synthetic ? (a.u ? `@${a.u}` : 'ไม่มี username') : a.e];
  if (a.p?.sid) bits.push(a.p.sid);
  return bits.filter(Boolean).join(' · ');
}

// ── load + live ─────────────────────────────────────────────────────────────
async function load() {
  if (loading) return;
  loading = true;
  try {
    // The fingerprint FIRST: a change landing between the two reads is then
    // caught by the next tick instead of being adopted unseen.
    const p = await rpc('account_dashboard_pulse');
    const d = await rpc('account_dashboard');
    pulseV = p.v;
    checkedAt = Date.now();
    const before = byId;
    data = d;
    byId = new Map((d.accounts || []).map((a) => [a.id, a]));
    // What moved since the last read — painted briefly so a live change is seen.
    fresh = new Set();
    if (before.size) {
      for (const a of d.accounts || []) {
        const o = before.get(a.id);
        if (!o || o.s !== a.s) fresh.add(a.id);
      }
    }
    sum = summarize(d);
    checks = runChecks(d);
    issues = issuesById(checks);
    failed = false;
    say('');
    paintAll();
  } catch (e) {
    failed = true;
    say(e.message, 'error');
  } finally {
    loading = false;
    paintLive();
  }
}

async function pulse() {
  const p = await rpc('account_dashboard_pulse');
  checkedAt = Date.now();
  if (p.v !== pulseV) await load();
  else { failed = false; say(''); }
  paintLive();
}

function stopTimers() {
  clearInterval(timer); timer = null;
  clearInterval(ticker); ticker = null;
}

function paneHidden() {
  const pane = document.querySelector('[data-admin-pane="accounts"]');
  return !pane || pane.classList.contains('d-none');
}

function paintLive() {
  const dot = $('acctLiveDot');
  const main = $('acctLiveMain');
  if (!dot || !main) return;
  if (failed) {
    dot.className = 'acct-live-dot is-warn';
    main.textContent = 'อ่านข้อมูลไม่สำเร็จ — กดโหลดใหม่';
    return;
  }
  if (!data) { main.textContent = 'กำลังโหลด…'; return; }
  dot.className = 'acct-live-dot is-live';
  const secs = checkedAt ? Math.max(0, Math.round((Date.now() - checkedAt) / 1000)) : null;
  main.textContent = `สด · ${fmt(sum.total)} บัญชี${secs == null ? '' : ` · ตรวจล่าสุด ${secs < 5 ? 'เมื่อสักครู่' : `${secs} วินาทีที่แล้ว`}`}`;
}

// ── painting ────────────────────────────────────────────────────────────────
function paintAll() {
  paintKpis();
  paintStack('acctSignin', SIGNIN, sum.signin, SIGNIN_COLOR, 'signin');
  paintStack('acctDomain', DOMAINS, sum.domain, DOMAIN_COLOR, 'domain');
  paintSystems();
  paintRecency();
  paintSignups();
  paintRoster();
  paintFeed();
  paintChecks();
  paintList();
}

function paintKpis() {
  const bugs = checks.filter((c) => c.sev === 'bug').reduce((n, c) => n + c.count, 0);
  const review = checks.filter((c) => c.sev === 'review').reduce((n, c) => n + c.count, 0);
  const tile = (num, label, opts = {}) => {
    const tag = opts.filter ? 'button' : 'div';
    const attrs = opts.filter ? ` type="button" data-set-filter='${escHtml(JSON.stringify(opts.filter))}'` : '';
    return `<${tag} class="acct-kpi ${opts.cls || ''}"${attrs}>
      <span class="acct-kpi-num">${fmt(num)}</span><span class="acct-kpi-label">${escHtml(label)}</span></${tag}>`;
  };
  $('acctKpis').innerHTML = [
    tile(sum.total, 'บัญชีทั้งหมด', { filter: {} }),
    tile(sum.active1, 'เข้าใช้ใน 24 ชม.', { filter: { recency: 'd1' } }),
    tile(sum.active7, 'เข้าใช้ใน 7 วัน'),
    tile(sum.active30, 'เข้าใช้ใน 30 วัน'),
    tile(sum.new30, 'สมัครใหม่ 30 วัน', { filter: { sort: 'created' } }),
    tile(bugs, bugs ? 'จุดผิดพลาดที่ต้องแก้' : 'ไม่พบจุดผิดพลาด', { cls: bugs ? 'is-bug' : 'is-clean' }),
    tile(review, 'รายการควรตรวจ'),
  ].join('');
}

function paintStack(host, defs, counts, colors, kind) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const on = filters[kind];
  const segs = defs.filter((d) => counts[d.key] > 0).map((d) => `<button type="button" class="acct-seg"
      style="flex:${counts[d.key]};background:${colors[d.key]}" data-filter="${kind}" data-value="${d.key}"
      data-tip="${escHtml(`${d.label}: ${fmt(counts[d.key])} บัญชี (${pct(counts[d.key], total)})`)}"
      aria-label="${escHtml(`${d.label} ${counts[d.key]} บัญชี`)}"></button>`).join('');
  const legend = defs.map((d) => `<button type="button" class="acct-legend-item${counts[d.key] ? '' : ' is-zero'}${on === d.key ? ' is-on' : ''}"
      data-filter="${kind}" data-value="${d.key}" aria-pressed="${on === d.key}">
      <span class="acct-swatch" style="background:${colors[d.key]}"></span>
      <span>${escHtml(d.label)}</span><span class="acct-n">${fmt(counts[d.key])}</span>
      <span class="acct-pct">${pct(counts[d.key], total)}</span></button>`).join('');
  $(host).innerHTML = `<div class="acct-stack" role="img" aria-label="สัดส่วน">${segs}</div><div class="acct-legend">${legend}</div>`;
}

function hrow(label, icon, n, of, filter) {
  const w = of ? Math.max(n ? 1.5 : 0, (n / of) * 100) : 0;
  const on = filter && filters[filter[0]] === filter[1];
  const tag = filter ? 'button' : 'div';
  const attrs = filter ? ` type="button" data-filter="${filter[0]}" data-value="${filter[1]}" aria-pressed="${!!on}"` : '';
  return `<${tag} class="acct-hrow${on ? ' is-on' : ''}"${attrs} data-tip="${escHtml(`${label}: ${fmt(n)} จาก ${fmt(of)} (${pct(n, of)})`)}">
    <span class="acct-hrow-label">${icon ? `<i class="bi ${icon}" aria-hidden="true"></i>` : ''}<span>${escHtml(label)}</span></span>
    <span class="acct-track"><span class="acct-fill" style="width:${w.toFixed(1)}%"></span></span>
    <span class="acct-hrow-n"><b>${fmt(n)}</b> <span>${pct(n, of)}</span></span></${tag}>`;
}

function paintSystems() {
  $('acctSystems').innerHTML = `<div class="acct-hbars">${SYSTEMS.map((s) =>
    hrow(s.label, s.icon, sum.systems[s.key], sum.total, ['system', s.key])).join('')}</div>
    <div class="small text-muted mt-2">นับบัญชีที่ผูกกับระบบนั้น จับคู่ด้วยอีเมลแบบเดียวกับที่เว็บใช้</div>`;
}

function columns(items, { kind, muted } = {}) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const bars = items.map((i) => {
    const on = kind && filters[kind] === i.key;
    const tag = kind ? 'button' : 'div';
    const attrs = kind ? ` type="button" data-filter="${kind}" data-value="${i.key}" aria-pressed="${!!on}"` : '';
    return `<${tag} class="acct-col${muted?.(i) ? ' is-muted' : ''}${on ? ' is-on' : ''}"${attrs}
      style="--h:${((i.n / max) * 100).toFixed(1)}%" data-tip="${escHtml(i.tip)}" aria-label="${escHtml(i.tip)}">
      ${i.showVal === false ? '' : `<span class="acct-col-val">${i.n ? fmt(i.n) : ''}</span>`}<span class="acct-col-bar"></span></${tag}>`;
  }).join('');
  return `<div class="acct-cols">${bars}</div><div class="acct-axis">${items.map((i) => `<span>${escHtml(i.axis || '')}</span>`).join('')}</div>`;
}

function paintRecency() {
  $('acctRecency').innerHTML = columns(RECENCY.map((r) => ({
    key: r.key, n: sum.recency[r.key], axis: r.label,
    tip: `${r.key === 'never' ? 'ไม่เคยเข้าสู่ระบบ' : `เข้าล่าสุดภายใน ${r.label}`}: ${fmt(sum.recency[r.key])} บัญชี`,
  })), { kind: 'recency', muted: (i) => i.key === 'never' || i.key === 'older' })
    + '<div class="small text-muted mt-2">แต่ละแท่งนับเฉพาะช่วงนั้น (ไม่ซ้อนกัน)</div>';
}

function paintSignups() {
  const weeks = sum.signups;
  const total = weeks.reduce((n, w) => n + w.n, 0);
  let lastMonth = null;
  const items = weeks.map((w) => {
    const d = new Date(w.w);
    const month = d.toLocaleDateString('th-TH', { month: 'short' });
    const axis = month !== lastMonth ? month : '';
    lastMonth = month;
    return { key: String(w.w), n: w.n, axis, showVal: weeks.length <= 30,
      tip: `สัปดาห์เริ่ม ${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}: ${fmt(w.n)} บัญชีใหม่` };
  });
  $('acctSignups').innerHTML = `<div class="acct-weeks">${columns(items)}</div>
    <div class="small text-muted mt-2">${fmt(total)} บัญชี ใน ${fmt(weeks.length)} สัปดาห์ · นับจากวันที่สร้างบัญชี</div>`;
}

/** "MD54 · ปี 1" — รุ่น, and the ชั้นปี that รุ่น is in now (study-year.js). */
function cohortName(co) {
  if (!co) return 'ไม่ระบุรุ่น';
  return [cohortLabel({ cohort_year: co }), studyYearLabel({ cohort_year: co })].filter(Boolean).join(' · ');
}

function paintRoster() {
  const rows = (data.roster || []).filter((r) => r.n > 0);
  const total = rows.reduce((n, r) => n + r.n, 0);
  const acc = rows.reduce((n, r) => n + r.acc, 0);
  $('acctRoster').innerHTML = `<div class="acct-hbars">${rows.map((r) =>
    hrow(cohortName(r.co), null, r.acc, r.n, null)).join('')}</div>
    <div class="small text-muted mt-2">รวม ${fmt(acc)} จาก ${fmt(total)} คนในทะเบียน (${pct(acc, total)}) — นับจาก kkumail ในทะเบียนที่ตรงกับบัญชี</div>`;
}

function paintFeed() {
  const ev = activity(data, 10);
  $('acctFeed').innerHTML = ev.length ? `<ul class="acct-feed">${ev.map((e) => `<li class="${fresh.has(e.a.id) ? 'is-fresh' : ''}">
      <i class="bi ${e.kind === 'signup' ? 'bi-person-plus' : 'bi-box-arrow-in-right'}" aria-hidden="true"></i>
      <span class="acct-feed-who"><button type="button" data-open="${escHtml(e.a.id)}">${escHtml(whoName(e.a))}</button>
        <span class="text-muted">${e.kind === 'signup' ? 'สมัครใหม่' : 'เข้าสู่ระบบ'}</span></span>
      <time datetime="${escHtml(e.at)}" title="${escHtml(thDateTime(e.at))}">${escHtml(ago(e.at, data.now))}</time></li>`).join('')}</ul>`
    : '<div class="text-muted small">ยังไม่มีความเคลื่อนไหว</div>';
}

function paintChecks() {
  const open = new Set([...document.querySelectorAll('#acctChecks .acct-check[data-open="1"]')].map((el) => el.dataset.check));
  $('acctChecks').innerHTML = `<div class="acct-checks">${checks.map((c) => {
    const sev = SEVERITY[c.sev];
    const clear = c.count === 0;
    const listable = !!c.ids && !clear;
    const isOpen = open.has(c.id);
    let extra = '';
    if (c.rows && c.count) {
      const rows = c.rows.slice(0, 12).map((r) => (r.from
        ? `<tr><td>${escHtml(r.from)} → ${escHtml(r.to)}</td><td>${escHtml(thDate(r.at))}</td></tr>`
        : `<tr><td>${escHtml(r.n || '–')}</td><td>${escHtml(r.e || '')}</td><td class="text-end">${fmt(r.km)} กม. · ${fmt(r.sc)} สแกน</td></tr>`)).join('');
      extra = `<table class="acct-mini"><tbody>${rows}</tbody></table>${c.count > 12 ? `<div class="mt-1">…และอีก ${fmt(c.count - 12)} รายการ</div>` : ''}`;
    }
    // A check with nothing to report reads as PASSED, not in its alarm colour —
    // a red ✕ beside a 0 looks like a failure.
    const pass = clear && c.sev !== 'expected';
    const tone = pass ? 'pass' : c.sev;
    return `<div class="acct-check is-${tone}${clear ? ' is-clear' : ''}" data-check="${c.id}" data-open="${isOpen ? 1 : 0}">
      <button type="button" class="acct-check-head" data-check-toggle="${c.id}" aria-expanded="${isOpen}">
        <span class="acct-sev is-${tone}"><i class="bi ${pass ? 'bi-check-lg' : sev.icon}" aria-hidden="true"></i>${escHtml(pass ? 'ผ่าน' : sev.label)}</span>
        <span class="acct-check-title">${escHtml(c.title)}</span>
        <span class="acct-check-n">${fmt(c.count)}</span>
      </button>
      <div class="acct-check-body"${isOpen ? '' : ' hidden'}>
        <p>${escHtml(c.why)}</p>
        <p><b>ทำอย่างไร:</b> ${escHtml(c.fix)}</p>
        ${listable ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-set-filter='${escHtml(JSON.stringify({ check: c.id }))}'>ดู ${fmt(c.count)} บัญชีในรายการด้านล่าง</button>` : ''}
        ${extra}
      </div></div>`;
  }).join('')}</div>`;
}

function rowHtml(a) {
  const s = signinOf(a);
  const sys = systemsOf(a);
  const mine = issues.get(a.id) || [];
  const bySev = {};
  for (const c of mine) bySev[c.sev] = (bySev[c.sev] || 0) + 1;
  const badges = [];
  if (s === 'google' || s === 'both') badges.push('<span class="acct-badge is-google">Google</span>');
  if (s === 'password' || s === 'both') badges.push(`<span class="acct-badge is-pw"><i class="bi bi-key" aria-hidden="true"></i>${domainOf(a.e) === 'synthetic' ? 'username' : 'รหัส'}</span>`);
  if (s === 'none') badges.push('<span class="acct-badge is-none">เข้าไม่ได้</span>');
  const sysIcons = SYSTEMS.filter((x) => x.key !== 'grants' && x.key !== 'master').map((x) =>
    `<i class="bi ${x.icon}${sys[x.key] ? ' is-on' : ''}" title="${escHtml(`${x.label}: ${sys[x.key] ? 'มี' : 'ไม่มี'}`)}"></i>`).join('');
  const issueHtml = ['bug', 'review', 'info'].filter((k) => bySev[k]).map((k) =>
    `<span class="acct-issue-n is-${k}" title="${escHtml(mine.filter((c) => c.sev === k).map((c) => c.title).join(' · '))}"><i class="bi ${SEVERITY[k].icon}" aria-hidden="true"></i>${bySev[k]}</span>`).join('');
  return `<tr tabindex="0" data-open="${escHtml(a.id)}" class="${fresh.has(a.id) ? 'is-fresh' : ''}">
    <td class="acct-who"><div class="acct-who-name">${escHtml(whoName(a))}${sys.master ? ' <span class="acct-badge is-master">Master</span>' : ''}</div>
      <div class="acct-who-sub">${escHtml(whoSub(a))}</div></td>
    <td>${badges.join('')}</td>
    <td class="d-none d-md-table-cell"><span class="acct-sys">${sysIcons}</span></td>
    <td class="d-none d-lg-table-cell acct-when" title="${escHtml(thDateTime(a.c))}">${escHtml(thDate(a.c))}</td>
    <td class="acct-when" title="${escHtml(thDateTime(a.s))}">${a.s ? escHtml(ago(a.s, data.now)) : '<span class="text-muted">ไม่เคย</span>'}</td>
    <td class="text-end">${issueHtml}</td></tr>`;
}

function currentList() {
  const list = filterAccounts(data.accounts || [], filters, checks, sum.nowMs);
  return sortAccounts(list, sortKey, issues);
}

function paintList() {
  const list = currentList();
  $('acctRows').innerHTML = list.slice(0, shown).map(rowHtml).join('')
    || '<tr><td colspan="6" class="text-center text-muted py-4">ไม่พบบัญชีที่ตรงกับตัวกรอง</td></tr>';
  $('acctCount').textContent = `แสดง ${fmt(Math.min(shown, list.length))} จาก ${fmt(list.length)} บัญชี`
    + (list.length !== sum.total ? ` (ทั้งหมด ${fmt(sum.total)})` : '');
  const more = $('acctMore');
  more.hidden = list.length <= shown;
  more.textContent = `แสดงเพิ่ม (${fmt(Math.min(PAGE, list.length - shown))})`;
  const chips = Object.entries(filters).filter(([k, v]) => v && k !== 'q').map(([k, v]) =>
    `<button type="button" class="acct-chip" data-clear="${k}">${escHtml(FILTER_LABEL[k]?.(v) || v)} <i class="bi bi-x" aria-hidden="true"></i></button>`);
  if (chips.length > 1) chips.push('<button type="button" class="acct-chip" data-clear="*">ล้างทั้งหมด</button>');
  $('acctFilters').innerHTML = chips.join('');
}

function setFilter(kind, value) {
  filters[kind] = filters[kind] === value ? undefined : value;
  repaintFiltered();
}

/** Everything that shows which filter is on, plus the list itself. */
function repaintFiltered() {
  shown = PAGE;
  paintStack('acctSignin', SIGNIN, sum.signin, SIGNIN_COLOR, 'signin');
  paintStack('acctDomain', DOMAINS, sum.domain, DOMAIN_COLOR, 'domain');
  paintSystems();
  paintRecency();
  paintList();
}

function scrollToList() {
  $('acctListCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── detail ──────────────────────────────────────────────────────────────────
function dl(pairs) {
  return `<dl class="acct-dl">${pairs.filter(([, v]) => v !== undefined).map(([k, v]) =>
    `<dt>${escHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function openDetail(id) {
  const a = byId.get(id);
  if (!a) return;
  const el = $('acctDetailModal');
  // Bootstrap cannot show a modal inside a display:none ancestor, and the pane
  // is one when another section is open — so it lives on <body>.
  if (el.parentElement !== document.body) document.body.appendChild(el);
  const mine = (issues.get(a.id) || []);
  const s = signinOf(a);
  const g = grantsOf(a);
  const manual = new Set(a.pm || []);
  const yes = (b) => (b ? 'ใช่' : 'ไม่');
  const copyBtn = (v, label) => `<button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline" data-copy="${escHtml(v)}">${escHtml(label)}</button>`;
  const parts = [];
  if (mine.length) {
    parts.push('<div class="acct-detail-h">ที่ระบบตรวจพบ</div>' + mine.map((c) =>
      `<div class="acct-detail-issue is-${c.sev}"><b>${escHtml(c.title)}</b><br>${escHtml(c.why)}<br><span class="text-muted">ทำอย่างไร: ${escHtml(c.fix)}</span></div>`).join(''));
  }
  parts.push('<div class="acct-detail-h">บัญชี</div>' + dl([
    ['อีเมล', domainOf(a.e) === 'synthetic'
      ? `<span class="text-muted">ไม่มีอีเมลจริง</span> (${escHtml(a.e || '')})`
      : `${escHtml(a.e || '–')}${a.e ? copyBtn(a.e, 'คัดลอก') : ''}`],
    ['Username', a.u ? escHtml(`@${a.u}`) : '<span class="text-muted">ไม่มี</span>'],
    ['ชื่อในบัญชี', escHtml(a.n || '–')],
    ['เข้าสู่ระบบด้วย', escHtml(SIGNIN.find((x) => x.key === s)?.label || s)
      + (a.pv?.length ? ` <span class="text-muted">(${escHtml(a.pv.join(', '))})</span>` : '')],
    ['สมัครเมื่อ', escHtml(thDateTime(a.c))],
    ['เข้าล่าสุด', a.s ? `${escHtml(thDateTime(a.s))} · ${escHtml(ago(a.s, data.now))}` : 'ไม่เคย'],
    ['ยืนยันอีเมล', yes(a.cf)],
    ...(a.b ? [['ถูกระงับ', 'ใช่']] : []),
    ['ID', `<code>${escHtml(a.id)}</code>${copyBtn(a.id, 'คัดลอก')}`],
  ]));
  parts.push('<div class="acct-detail-h">ทะเบียนคน · ระบบบ้าน</div>' + (a.p ? dl([
    ['ชื่อ', escHtml(a.p.n || '–') + (a.p.nk ? ` (${escHtml(a.p.nk)})` : '')],
    ['รหัสนักศึกษา', escHtml(a.p.sid || '–')],
    // รุ่น only: a person's ชั้นปี also needs their year_offset, which this
    // payload does not carry — a ชั้นปี without it can be wrong.
    ['รุ่น', escHtml(cohortLabel({ cohort_year: a.p.co, student_id: a.p.sid }) || '–')],
    ['สาขา', escHtml(a.p.mj || '–')],
    ['ยืนยันตัวตนแล้ว', yes(a.p.ok)],
    ['ระบบบ้าน', a.hs ? `อยู่ในระบบบ้าน${a.h ? ` · สาย ${escHtml(a.h)}` : ''}` : 'ไม่อยู่'],
  ]) : '<p class="small text-muted">ไม่พบในทะเบียนคน (จับคู่จากอีเมลบัญชีกับ kkumail ในทะเบียน)</p>'));
  parts.push('<div class="acct-detail-h">ทีม SAMO · สิทธิ์</div>' + dl([
    ['ตำแหน่ง', a.t?.length ? a.t.map((t) => escHtml(t)).join(', ') : '<span class="text-muted">ไม่มี</span>'],
    ['สิทธิ์', g.length ? g.map((k) => `<span class="acct-perm${manual.has(k) ? ' is-manual' : ''}" title="${manual.has(k) ? 'ใส่ตรงในฐานข้อมูล ไม่ได้มาจากทีม SAMO' : 'มาจากทีม SAMO'}">${escHtml(PERM_LABEL[k] || k)}</span>`).join('') : '<span class="text-muted">ไม่มี</span>'],
    ['Discord', a.d ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'],
  ]));
  parts.push('<div class="acct-detail-h">SAMO Passport</div>' + (a.pp ? dl([
    ['ระยะสะสม', `${fmt(a.pp.km)} กม.`],
    ['สแกน', `${fmt(a.pp.sc)} ครั้ง`],
    ['สแกนล่าสุด', a.pp.ls ? escHtml(thDateTime(a.pp.ls)) : '–'],
  ]) : '<p class="small text-muted">ยังไม่มีโปรไฟล์ Passport (สร้างเองเมื่อเปิด Passport ครั้งแรก)</p>'));
  $('acctDetailTitle').textContent = whoName(a);
  $('acctDetailBody').innerHTML = parts.join('');
  window.bootstrap?.Modal.getOrCreateInstance(el).show();
}

// ── CSV of what the list shows ──────────────────────────────────────────────
function exportCsv() {
  const list = currentList();
  const head = ['ชื่อ', 'อีเมล', 'username', 'เข้าสู่ระบบด้วย', 'กลุ่มอีเมล', 'สมัครเมื่อ', 'เข้าล่าสุด',
    'รหัสนักศึกษา', 'รุ่น', 'ระบบบ้าน', 'Passport', 'ทีม SAMO', 'Discord', 'สิทธิ์', 'ปัญหา'];
  const rows = list.map((a) => {
    const sys = systemsOf(a);
    return [whoName(a), domainOf(a.e) === 'synthetic' ? '' : a.e, a.u || '',
      SIGNIN.find((x) => x.key === signinOf(a))?.label, DOMAINS.find((x) => x.key === domainOf(a.e))?.label,
      a.c || '', a.s || '', a.p?.sid || '', cohortLabel({ cohort_year: a.p?.co, student_id: a.p?.sid }) || '', sys.house ? 'ใช่' : '', sys.passport ? 'ใช่' : '',
      (a.t || []).join(' / '), sys.discord ? 'ใช่' : '', grantsOf(a).join(' '),
      (issues.get(a.id) || []).map((c) => c.title).join(' / ')];
  });
  const cell = (v) => `"${csvGuard(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `samo-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── wiring ──────────────────────────────────────────────────────────────────
function wire() {
  if (wired) return;
  wired = true;
  const root = document.querySelector('.acct');
  $('acctSort').innerHTML = Object.entries(SORTS).map(([k, s]) => `<option value="${k}">เรียง: ${escHtml(s.label)}</option>`).join('');
  $('acctSort').value = sortKey;
  $('acctSort').addEventListener('change', (e) => { sortKey = e.target.value; shown = PAGE; paintList(); });
  let qTimer = null;
  $('acctSearch').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { filters.q = e.target.value; shown = PAGE; if (data) paintList(); }, 150);
  });
  $('acctMore').addEventListener('click', () => { shown += PAGE; paintList(); });
  $('acctRefresh').addEventListener('click', () => { load(); });
  $('acctCsv').addEventListener('click', () => { if (data) exportCsv(); });

  root.addEventListener('click', (e) => {
    if (!data) return;
    const f = e.target.closest('[data-filter]');
    if (f) { setFilter(f.dataset.filter, f.dataset.value); return; }
    const sf = e.target.closest('[data-set-filter]');
    if (sf) {
      const want = JSON.parse(sf.dataset.setFilter);
      if (!Object.keys(want).length) { filters = { q: filters.q }; }
      for (const [k, v] of Object.entries(want)) {
        if (k === 'sort') { sortKey = v; $('acctSort').value = v; } else filters[k] = v;
      }
      shown = PAGE;
      paintAll();
      scrollToList();
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      if (clear.dataset.clear === '*') filters = { q: filters.q };
      else filters[clear.dataset.clear] = undefined;
      repaintFiltered();
      return;
    }
    const tog = e.target.closest('[data-check-toggle]');
    if (tog) {
      const box = tog.closest('.acct-check');
      const open = box.dataset.open !== '1';
      box.dataset.open = open ? '1' : '0';
      tog.setAttribute('aria-expanded', String(open));
      box.querySelector('.acct-check-body').hidden = !open;
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) openDetail(op.dataset.open);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-open]');
    if (tr && e.target === tr) { e.preventDefault(); openDetail(tr.dataset.open); }
  });
  $('acctDetailModal').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    await copyText(b.dataset.copy);
    b.textContent = 'คัดลอกแล้ว';
  });

  // One tooltip for every mark that carries data-tip (hover + keyboard focus).
  const tip = $('acctTip');
  const showTip = (t, x, y) => {
    tip.textContent = t;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
  };
  root.addEventListener('pointermove', (e) => {
    const m = e.target.closest('[data-tip]');
    if (!m) { tip.hidden = true; return; }
    showTip(m.dataset.tip, e.clientX, e.clientY);
  });
  root.addEventListener('pointerleave', () => { tip.hidden = true; });
  root.addEventListener('focusin', (e) => {
    const m = e.target.closest('[data-tip]');
    if (!m) return;
    const r = m.getBoundingClientRect();
    showTip(m.dataset.tip, r.left + r.width / 2, r.top);
  });
  root.addEventListener('focusout', () => { tip.hidden = true; });
}

/** Entry from admin-main.js, every time the section is opened. */
export function enterAccounts() {
  wire();
  // The same question the RPC asks (current_user_has_permission('master')),
  // asked first so a non-master reads a sentence instead of a 42501.
  if (!holdsMaster(getUser())) {
    stopTimers();
    failed = true;
    say('หน้านี้สำหรับผู้มีสิทธิ์ Master ในทีม SAMO เท่านั้น', 'error');
    paintLive();
    return;
  }
  load();
  stopTimers();
  timer = setInterval(() => {
    if (paneHidden()) { stopTimers(); return; }
    if (document.hidden || loading) return;   // a background tab skips a tick, it does not stop
    pulse().catch((e) => { failed = true; say(e.message, 'error'); paintLive(); });
  }, POLL_MS);
  ticker = setInterval(() => { if (paneHidden()) stopTimers(); else paintLive(); }, 5000);
}

