// ==============================================
// analytics-dashboard.js — the staff-only "สถิติการใช้งาน" admin section.
// Fetches analytics_overview(days) (migration 0065) and renders KPI tiles
// + time-series bar charts + top-tabs / role breakdowns. Pure DOM/CSS
// rendering (no chart library) to keep the bundle lean.
//
// Data sources: the RPC combines the real engagement tables (users,
// pr/vs tickets, projects, documents, orders) with analytics_events. The
// engagement numbers are populated immediately; the session/visitor and
// top-tab panels fill in as the cookieless tracker (analytics.js) collects
// data after deploy.
// ==============================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';

let wired = false;
let lastDays = 30;

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

/** Completion donut ring (fills when .is-in is set on an ancestor). */
function ring(name, total, done, color) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const off = (RING_C * (1 - pct / 100)).toFixed(1);
  return `<div class="an-ring-card">
    <div class="an-ring">
      <svg viewBox="0 0 110 110" aria-hidden="true">
        <circle class="an-ring-track" cx="55" cy="55" r="${RING_R}"></circle>
        <circle class="an-ring-fill" cx="55" cy="55" r="${RING_R}" style="--c:${RING_C.toFixed(1)};--off:${off};stroke:${color}"></circle>
      </svg>
      <span class="an-ring-pct" style="color:${color}">${pct}%</span>
    </div>
    <div class="an-ring-meta">
      <span class="an-ring-name">${escHtml(name)}</span>
      <span class="an-ring-sub"><b>${fmt(done)}</b> เสร็จสิ้น / ${fmt(total)} คำขอ</span>
    </div>
  </div>`;
}

function projStat(label, value, accent) {
  return `<div class="an-proj-stat" style="--ps:${accent}">
    <span class="an-proj-num">${fmt(value)}</span>
    <span class="an-proj-label">${escHtml(label)}</span>
  </div>`;
}

/** 'YYYY-MM-DD' → Thai short date, e.g. '1 ก.ค.'. */
function fmtDay(d) {
  const dt = new Date(`${String(d)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

/** Vertical bar chart from a [{d,n}] daily series, with a date axis under
 *  it (~6 evenly-spaced ticks) so each bar's date is legible without hover.
 *  CSS bars, responsive; per-bar hover tooltip still shows date + value. */
function barChart(series, color) {
  const pts = Array.isArray(series) ? series : [];
  const total = pts.reduce((a, p) => a + Number(p.n || 0), 0);
  if (!pts.length || total === 0) {
    return `<div class="an-chart-empty">ยังไม่มีข้อมูลในช่วงนี้ — จะเริ่มแสดงเมื่อมีการใช้งาน</div>`;
  }
  const max = Math.max(1, ...pts.map((p) => Number(p.n || 0)));
  const bars = pts.map((p) => {
    const h = Math.round((Number(p.n || 0) / max) * 100);
    const label = escHtml(`${fmtDay(p.d)} · ${fmt(p.n)}`);
    return `<div class="an-bar" style="--h:${h}%;--bar:${color}" title="${label}"><span class="an-bar-val">${p.n > 0 ? fmt(p.n) : ''}</span></div>`;
  }).join('');

  // Date axis: ~6 evenly-spaced ticks (dedup for very short ranges).
  const n = pts.length;
  const ticks = Math.min(n, 6);
  const seen = new Set();
  const axis = [];
  for (let k = 0; k < ticks; k += 1) {
    const i = Math.round((k * (n - 1)) / Math.max(ticks - 1, 1));
    if (seen.has(i)) continue;
    seen.add(i);
    axis.push(`<span>${escHtml(fmtDay(pts[i].d))}</span>`);
  }

  return `<div class="an-bars" role="img" aria-label="กราฟรายวัน">${bars}</div>
    <div class="an-axis">${axis.join('')}</div>`;
}

/** Horizontal ranked bars from [{label,n}]. */
function rankBars(rows, color, mapLabel = (x) => x) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return `<div class="an-chart-empty">ยังไม่มีข้อมูล</div>`;
  const max = Math.max(1, ...items.map((r) => Number(r.n || 0)));
  return `<div class="an-rank">${items.map((r) => {
    const w = Math.round((Number(r.n || 0) / max) * 100);
    // r.label (path / role) can be attacker-controlled — analytics_events
    // is anon-INSERTable, so an injected path must never reach innerHTML raw.
    const disp = escHtml(String(mapLabel(r.label) ?? ''));
    return `<div class="an-rank-row">
      <span class="an-rank-label" title="${disp}">${disp}</span>
      <span class="an-rank-track"><span class="an-rank-fill" style="width:${w}%;background:${color}"></span></span>
      <span class="an-rank-n">${fmt(r.n)}</span>
    </div>`;
  }).join('')}</div>`;
}

const ROLE_TH = {
  user: 'นักศึกษา', vp_admin: 'VP-Admin', dev: 'Dev', pr_staff: 'PR Staff',
  vs_staff: 'VS Staff', uni_staff: 'Uni Staff', shop_admin: 'Shop Admin', sa_prof: 'อาจารย์',
};
const TAB_TH = {
  'tab:home': 'หน้าแรก', 'tab:pr': 'PR', 'tab:vitalsound': 'VitalSound', 'tab:shop': 'ร้านค้า',
  'tab:announcements': 'ประกาศ', 'tab:about': 'เกี่ยวกับ', 'tab:tools': 'เครื่องมือ',
  'tab:departments': 'ฝ่าย', 'tab:team': 'ทีม', 'tab:projects-view': 'ติดตามโครงการ',
};

function tile(num, label, sub, accent) {
  return `<div class="an-kpi" style="--kpi:${accent}">
    <span class="an-kpi-num">${fmt(num)}</span>
    <span class="an-kpi-label">${label}</span>
    ${sub ? `<span class="an-kpi-sub">${sub}</span>` : ''}
  </div>`;
}

/**
 * อีเมลแจ้งเตือน — daily sends against the Apps Script ceiling.
 *
 * WHY THIS PANEL EXISTS. The owner asked "is 100 a day enough, and have we
 * ever hit it?" and nobody could answer: the send is fire-and-forget
 * (`callGAS(...).catch(() => {})` in projects/notify.js), so a refusal reaches
 * a console nobody reads. Measured 2026-08-28: 95 sends in 72 days, busiest
 * day 7. The answer is a comfortable yes — but it should not take a database
 * session to find that out again.
 *
 * The number is an ESTIMATE derived from the notification fan-out (see
 * migration 0170), and it has exactly one way to lie: if the in-app half of
 * the notification is switched off while email stays on, no rows are written
 * and this reads ZERO while mail is still going out. So when `in_app_enabled`
 * is false we say the number cannot be trusted instead of drawing a confident
 * empty chart. `analytics-email.test.js` pins that.
 */
function emailPanel(e) {
  if (!e) return '';
  const quota = Number(e.quota_per_day || 100);
  const recip = Math.max(Number(e.recipients || 0), 0);
  const peak = Number(e.peak_day || 0);
  // The ceiling counts RECIPIENTS, so two addresses cost two per send.
  const peakCost = peak * Math.max(recip, 1);
  const pct = Math.min(100, Math.round((peakCost / quota) * 100));
  const tone = pct >= 80 ? '#dc2626' : pct >= 50 ? 'var(--brand-orange,#FF6F30)' : 'var(--brand-primary,#105922)';

  let warn = '';
  if (e.enabled === false) {
    warn = `<div class="an-email-note">อีเมลแจ้งเตือนถูกปิดอยู่ — ระบบไม่ได้ส่งอีเมลในขณะนี้</div>`;
  } else if (e.in_app_enabled === false || Number(e.staff_holders || 0) === 0) {
    // TWO CAUSES, ONE SYMPTOM, and the symptom is the dangerous one: a zero
    // that means "we are not counting", read as "we are not sending".
    //
    //   1. the in-app half switched off — no rows written, mail still sent;
    //   2. NOBODY HOLDS THE STAFF SEAT — the in-app loop runs over an empty
    //      list, but the email does not depend on that list at all. Look at
    //      notifyUniStaff(): the send is gated on `notify_uni_email !== false
    //      && to`, and `to` comes from the SETTINGS, never from the seat.
    //
    // Cause 2 was missed when this panel was written and found by re-reading
    // the send path rather than the counting path. The count and the thing it
    // counts have different inputs; that gap is the whole hazard.
    warn = `<div class="an-email-note an-email-note--warn">ตัวเลขนี้เชื่อถือไม่ได้ในขณะนี้ —
      ระบบยังส่งอีเมลอยู่ แต่นับจำนวนไม่ได้ครบ จำนวนที่แสดงจึงต่ำกว่าความเป็นจริง</div>`;
  } else if (recip > Number(e.recipients_per_message_limit || 50)) {
    // Not a rate limit — a hard per-message cap. One address over and the send
    // fails outright, with nothing in the app to say so.
    warn = `<div class="an-email-note an-email-note--warn">ผู้รับต่อฉบับเกินที่ระบบส่งได้ —
      ตั้งไว้ ${fmt(recip)} คน แต่ส่งได้สูงสุด ${fmt(e.recipients_per_message_limit || 50)} คนต่อฉบับ
      อีเมลจะส่งไม่ออกทั้งฉบับ</div>`;
  } else if (Number(e.peak_per_minute || 0) >= Number(e.simultaneous_limit || 30) * 0.5) {
    warn = `<div class="an-email-note an-email-note--warn">ส่งพร้อมกันถี่ขึ้นมาก —
      สูงสุด ${fmt(e.peak_per_minute)} ฉบับในนาทีเดียว จากที่ระบบรับได้
      ${fmt(e.simultaneous_limit || 30)} พร้อมกัน</div>`;
  } else if (pct >= 80) {
    warn = `<div class="an-email-note an-email-note--warn">ใกล้ถึงขีดจำกัดรายวัน —
      วันที่ใช้มากที่สุดใช้ไป ${fmt(peakCost)} จาก ${fmt(quota)}</div>`;
  }

  const sub = recip > 1
    ? `${fmt(recip)} ผู้รับต่อครั้ง · สูงสุด ${fmt(peakCost)}/${fmt(quota)} ต่อวัน`
    : `สูงสุด ${fmt(peak)} จาก ${fmt(quota)} ต่อวัน`;

  return `<div class="an-card an-card--wide">
      <div class="an-card-head"><h3>อีเมลแจ้งเตือน (หนังสือโครงการ)</h3><span>${escHtml(sub)}</span></div>
      <div class="an-email-meter" style="--fill:${pct}%;--tone:${tone}">
        <div class="an-email-meter-bar"></div>
      </div>
      <div class="an-email-legend">
        <span><b>${fmt(e.sent_total)}</b> ฉบับในช่วงที่เลือก</span>
        <span><b>${fmt(peak)}</b> สูงสุดต่อวัน</span>
        <span><b>${fmt(Math.max(quota - peakCost, 0))}</b> คงเหลือในวันที่หนักที่สุด</span>
      </div>
      ${burstRow(e)}
      ${warn}
      ${barChart(e.sent_by_day, 'var(--brand-orange,#FF6F30)')}
    </div>`;
}

/**
 * The OTHER ceilings — the ones a comfortable daily total says nothing about.
 *
 * A day well inside 100 can still fail if it all arrives at once: Apps Script
 * caps simultaneous executions at 30 per user, and one message at 50
 * recipients. And unlike Discord — which is serialised through `queueDiscord`,
 * one global chain, deliberately spaced — the email path calls `callGAS`
 * DIRECTLY. Nothing spaces it. That asymmetry sits invisibly in two adjacent
 * lines of notify.js and only shows up under load, which is exactly the kind of
 * thing that belongs on a dashboard rather than in someone's memory.
 *
 * Measured 2026-08-28: busiest minute 2, busiest hour 5, tightest gap 7.7s —
 * against a limit of 30. Not close. This keeps that current instead of letting
 * it rot in a comment.
 */
function burstRow(e) {
  const perMin = Number(e.peak_per_minute || 0);
  const perHour = Number(e.peak_per_hour || 0);
  const gap = e.min_gap_seconds;
  const sim = Number(e.simultaneous_limit || 30);
  if (!perMin && !perHour) return '';
  const gapTxt = (gap === null || gap === undefined)
    ? '' : `<span>ห่างกันน้อยสุด <b>${fmt(gap)}</b> วินาที</span>`;
  return `<div class="an-email-legend an-email-legend--sub">
      <span>พร้อมกันมากสุด <b>${fmt(perMin)}</b> ฉบับ/นาที (ระบบรับได้ ${fmt(sim)})</span>
      <span><b>${fmt(perHour)}</b> ฉบับ/ชั่วโมง</span>
      ${gapTxt}
    </div>`;
}

/**
 * ALL Apps Script traffic — because the quota is a SHARED budget.
 *
 * Apps Script's ceilings are per GOOGLE ACCOUNT, not per script, and every
 * component draws on the same one: PR photo uploads, หนังสือโครงการ files,
 * shop slips, SAMO Passport, and the notification email above. A quiet email
 * month therefore says nothing about whether uploads are near the edge, which
 * is what the email panel alone was missing.
 *
 * TWO NUMBERS, DELIBERATELY. The in-range peak answers "how are we doing now";
 * the ALL-TIME peak answers "is the ceiling even reachable". They matter
 * separately, because the worst minute on record (25, on 2026-05-22) falls
 * outside a 30-day window — a range-only view would report "nothing to see"
 * about the one event proving it can happen.
 *
 * It is a FLOOR. Only calls that leave a database row can be counted: deletes,
 * folder reads, photo overwrites with no per-upload timestamp, anything from a
 * component outside this database, and every FAILED call are all invisible.
 * The panel says so rather than implying a complete count.
 */
/**
 * EVERY Apps Script action, and whether the dashboard can see it.
 *
 * The owner asked for this explicitly: "list all the action write in the stat".
 * It matters because the counted number is a FLOOR — showing a total without
 * showing what is missing from it invites the reader to treat it as complete.
 *
 * `counted` means the action leaves a database row with a usable timestamp.
 * The rest still consume the SAME shared quota and are simply invisible here;
 * a failed call of any kind is invisible too, which is the traffic you would
 * most want to see.
 *
 * Mirrored against `appscript/prform.gs` by `analytics-email.test.js` — two
 * hand-maintained copies of one list is a bug this repo has paid for
 * repeatedly, so the test fails if an action is added there and not here.
 */
const GAS_ACTIONS = [
  { name: 'uploadPRFile',          label: 'อัปโหลดไฟล์ PR',            counted: true },
  { name: 'uploadProjectFile',     label: 'อัปโหลดไฟล์หนังสือโครงการ',   counted: true },
  { name: 'uploadShopFile',        label: 'อัปโหลดสลิป/รูปร้านค้า',      counted: true },
  { name: 'uploadTeamFile',        label: 'อัปโหลดรูปทีม/สมาชิก',        counted: false },
  { name: 'notifyProjectEmail',    label: 'ส่งอีเมลแจ้งเตือน',           counted: true },
  { name: 'deletePRFile',          label: 'ลบไฟล์ PR',                  counted: false },
  { name: 'deleteProjectFile',     label: 'ลบไฟล์หนังสือโครงการ',        counted: false },
  { name: 'deleteProjectFolder',   label: 'ลบโฟลเดอร์โครงการ',           counted: false },
  { name: 'deleteShopFile',        label: 'ลบไฟล์ร้านค้า',               counted: false },
  { name: 'deleteTeamFile',        label: 'ลบรูปทีม',                   counted: false },
  { name: 'getProjectFolderInfo',  label: 'อ่านข้อมูลโฟลเดอร์',          counted: false },
  { name: 'getProjectFileData',    label: 'อ่านไฟล์โครงการ',             counted: false },
  { name: 'statProjectFiles',      label: 'ตรวจไฟล์ที่ยังอยู่',           counted: false },
  { name: 'listProjectFolderFiles', label: 'อ่านรายชื่อไฟล์ในโฟลเดอร์',   counted: false },
];

/** The action table — what uses the shared quota, and what we can see. */
function gasActionList() {
  const row = (a) => `<tr>
      <td>${escHtml(a.label)}</td>
      <td><code>${escHtml(a.name)}</code></td>
      <td>${a.counted
        ? '<span class="an-gas-yes">นับได้</span>'
        : '<span class="an-gas-no">มองไม่เห็น</span>'}</td>
    </tr>`;
  return `<div class="an-gas-actions">
      <table>
        <thead><tr><th>การทำงาน</th><th>ชื่อในระบบ</th><th>ในสถิตินี้</th></tr></thead>
        <tbody>${GAS_ACTIONS.map(row).join('')}</tbody>
      </table>
    </div>`;
}

function gasPanel(g) {
  if (!g) return '';
  const limit = Number(g.simultaneous_limit || 30);
  const ever = Number(g.peak_per_minute_ever || 0);
  const now = Number(g.peak_per_minute || 0);
  const pct = Math.min(100, Math.round((ever / limit) * 100));
  const tone = pct >= 80 ? '#dc2626' : pct >= 50 ? 'var(--brand-orange,#FF6F30)' : 'var(--brand-primary,#105922)';

  const warn = ever >= limit * 0.5
    ? `<div class="an-email-note an-email-note--warn">เคยมีช่วงที่เรียกใช้พร้อมกันถึง
        ${fmt(ever)} ครั้งในนาทีเดียว${g.busiest_minute_at ? ` (${escHtml(g.busiest_minute_at)})` : ''} —
        ระบบรับได้ ${fmt(limit)} พร้อมกัน ถ้าเกินกว่านี้จะมีบางรายการทำไม่สำเร็จโดยไม่มีคำเตือน</div>`
    : '';

  return `<div class="an-card an-card--wide">
      <div class="an-card-head">
        <h3>การเรียกใช้ระบบไฟล์และอีเมล (ทุกระบบรวมกัน)</h3>
        <span>สูงสุด ${fmt(ever)} ครั้ง/นาที จากที่รับได้ ${fmt(limit)}</span>
      </div>
      <div class="an-email-meter" style="--fill:${pct}%;--tone:${tone}">
        <div class="an-email-meter-bar"></div>
      </div>
      <div class="an-email-legend">
        <span><b>${fmt(g.total)}</b> ครั้งในช่วงที่เลือก</span>
        <span><b>${fmt(g.peak_per_day)}</b> สูงสุดต่อวัน</span>
        <span><b>${fmt(now)}</b> สูงสุดต่อนาทีในช่วงนี้</span>
      </div>
      <div class="an-email-legend an-email-legend--sub">
        <span>นับได้เฉพาะรายการที่บันทึกไว้ — การลบ การเปิดดูไฟล์
          และรายการที่ทำไม่สำเร็จ ไม่ถูกนับ ตัวเลขจริงจึงสูงกว่านี้${
          Number(g.excluded_bulk || 0)
            ? ` · ไม่นับ ${fmt(g.excluded_bulk)} รายการที่เป็นการนำเข้าข้อมูล ไม่ใช่การใช้งานจริง`
            : ''}</span>
      </div>
      ${warn}
      ${barChart(g.by_day, '#6366f1')}
      <div class="an-card-head" style="margin-top:.9rem"><h3>แยกตามระบบ</h3></div>
      ${rankBars((g.by_source || []).map((x) => ({ label: x.label, n: x.n })), '#6366f1')}
      <div class="an-card-head" style="margin-top:.9rem">
        <h3>สิ่งที่ใช้โควตาเดียวกัน</h3><span>ทุกระบบใช้บัญชี Google เดียวกัน</span>
      </div>
      ${gasActionList()}
    </div>`;
}

function render(body, d) {
  const t = d.totals || {};
  const a = d.active || {};
  const signupsSum = (d.signups_by_day || []).reduce((s, p) => s + Number(p.n || 0), 0);
  const reqDays = d.requests_by_day || [];
  const prSeries = reqDays.map((p) => ({ d: p.d, n: Number(p.pr || 0) }));
  const vsSeries = reqDays.map((p) => ({ d: p.d, n: Number(p.vs || 0) }));
  const prSum = prSeries.reduce((s, p) => s + p.n, 0);
  const vsSum = vsSeries.reduce((s, p) => s + p.n, 0);
  const gen = d.generated_at ? new Date(d.generated_at).toLocaleString('th-TH') : '';
  const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);

  body.innerHTML = `
    <div class="an-kpis">
      ${tile(t.users, 'สมาชิกทั้งหมด', 'ลงทะเบียนสะสม', 'var(--brand-primary,#105922)')}
      ${tile(signupsSum, `สมาชิกใหม่ (${d.range_days} วัน)`, 'ในช่วงที่เลือก', 'var(--brand-orange,#FF6F30)')}
      ${tile(a.sessions_wau, 'ผู้เข้าใช้ / สัปดาห์', 'เซสชันไม่ซ้ำ (WAU)', 'var(--vs-accent,#0d9488)')}
      ${tile(a.sessions_mau, 'ผู้เข้าใช้ / เดือน', 'เซสชันไม่ซ้ำ (MAU)', '#6366f1')}
      ${tile(t.pr, 'คำขอ PR', `เสร็จสิ้น ${fmt(t.pr_completed)} · ${pct(t.pr_completed, t.pr)}%`, 'var(--pink-500,#d6336c)')}
      ${tile(t.vs, 'คำขอ VitalSound', `เสร็จสิ้น ${fmt(t.vs_completed)} · ${pct(t.vs_completed, t.vs)}%`, '#0ea5e9')}
    </div>

    <div class="an-section-label">อัตราการดำเนินงานรับเรื่องนักศึกษา</div>
    <div class="an-rings an-rings--2">
      ${ring('งานประชาสัมพันธ์ (PR)', t.pr, t.pr_completed, 'var(--pink-500,#d6336c)')}
      ${ring('VitalSound', t.vs, t.vs_completed, '#0ea5e9')}
    </div>

    <div class="an-proj-panel">
      <div class="an-proj-panel-head">
        <span class="an-proj-badge"><i class="bi bi-folder-fill"></i></span>
        <div><h3>หนังสือโครงการ</h3><span>ระบบส่ง–รับ–ลงนามเอกสารโครงการ</span></div>
      </div>
      <div class="an-proj-panel-body">
        <div class="an-proj-ringwrap">${ring('เอกสารที่สำเร็จ', t.documents, t.doc_completed, 'var(--brand-primary,#105922)')}</div>
        <div class="an-proj-grid">
          ${projStat('หนังสือทั้งหมด', t.documents, '#6366f1')}
          ${projStat('สำเร็จ', t.doc_completed, 'var(--vs-accent,#0d9488)')}
          ${projStat('ลงนามแล้ว', t.doc_signed, '#0ea5e9')}
          ${projStat('ธุรกรรม', t.doc_transactions, 'var(--brand-orange,#FF6F30)')}
          ${projStat('การโต้ตอบ', t.doc_interactions, 'var(--pink-500,#d6336c)')}
          ${projStat('โครงการ', t.projects, 'var(--brand-primary,#105922)')}
        </div>
      </div>
    </div>

    <div class="an-grid">
      <div class="an-card an-card--wide">
        <div class="an-card-head"><h3>สมาชิกใหม่รายวัน</h3><span>รวม ${fmt(signupsSum)} คน</span></div>
        ${barChart(d.signups_by_day, 'var(--brand-orange,#FF6F30)')}
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3>คำขอ PR รายวัน</h3><span>รวม ${fmt(prSum)}</span></div>
        ${barChart(prSeries, 'var(--pink-500,#d6336c)')}
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3>คำขอ VitalSound รายวัน</h3><span>รวม ${fmt(vsSum)}</span></div>
        ${barChart(vsSeries, '#0ea5e9')}
      </div>
      <div class="an-card an-card--wide">
        <div class="an-card-head"><h3>ผู้เข้าใช้งานรายวัน</h3><span>เซสชันไม่ซ้ำ / วัน</span></div>
        ${barChart(d.visitors_by_day, 'var(--vs-accent,#0d9488)')}
      </div>
      ${emailPanel(d.email)}
      ${gasPanel(d.gas)}
      <div class="an-card">
        <div class="an-card-head"><h3>แท็บที่ใช้บ่อย</h3></div>
        ${rankBars((d.top_paths || []).map((p) => ({ label: p.path, n: p.n })), 'var(--brand-primary,#105922)', (l) => TAB_TH[l] || l)}
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3>สัดส่วนบทบาทผู้ใช้</h3></div>
        ${rankBars((d.roles || []).map((r) => ({ label: r.role, n: r.n })), '#6366f1', (l) => ROLE_TH[l] || l)}
      </div>
    </div>
    <p class="an-foot">อัปเดตล่าสุด ${gen} · ข้อมูลผู้เข้าใช้งาน/แท็บเริ่มเก็บหลังเผยแพร่ระบบสถิติ</p>
  `;
  // Fill the completion rings on the next frame (CSS transition). Covers the
  // PR/VS ring row AND the หนังสือโครงการ panel ring.
  requestAnimationFrame(() => {
    body.querySelectorAll('.an-rings, .an-proj-ringwrap').forEach((el) => el.classList.add('is-in'));
  });
}

async function load(days) {
  const body = document.getElementById('analyticsBody');
  if (!body) return;
  lastDays = days;
  body.innerHTML = `<div class="an-loading"><span class="spinner-border spinner-border-sm"></span> กำลังโหลดสถิติ…</div>`;
  const { data, error } = await dbRest('/rpc/analytics_overview', {
    method: 'POST', body: { days }, timeout: 12000,
  });
  if (error || !data) {
    body.innerHTML = `<div class="an-error">โหลดสถิติไม่สำเร็จ${error?.message ? ` — ${String(error.message).slice(0, 140)}` : ''}</div>`;
    return;
  }
  render(body, Array.isArray(data) ? data[0] : data);
}

/** Wire the range selector + refresh button once. */
export function initAnalyticsDashboard() {
  if (wired) return;
  wired = true;
  document.getElementById('analyticsRange')?.addEventListener('change', (e) => {
    load(Number(e.target.value) || 30);
  });
  document.getElementById('analyticsRefresh')?.addEventListener('click', () => load(lastDays));
}

/** Called on section entry — (re)load the current range. */
export function enterAnalytics() {
  const sel = document.getElementById('analyticsRange');
  load(Number(sel?.value) || 30);
}
