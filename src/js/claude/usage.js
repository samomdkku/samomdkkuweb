// ============================================================
// claude/usage.js — the MEASURED half of จองโควตา Claude.
//
// The board above this says what people CLAIMED. This says what Claude's own
// account actually spent, from claude_usage_samples: a reading every 15
// minutes, written by tools/claude-usage-report.mjs on the VM.
//
// EVERY NUMBER HERE IS COMPUTED IN SQL (get_claude_usage_log, migration 0155).
// Nothing in this file derives a percentage, attributes usage to a booking, or
// decides where a 5-hour window began. It formats. That split is not tidiness:
// the session rule already exists once, in claude_sessions(), and the moment a
// second copy of any of this arithmetic lives in JavaScript the two answer
// differently — the most expensive bug class in this repo.
//
// The one thing the payload cannot carry is the FRAME: which minute is at which
// pixel. That is here, and it is derived from the week's own two boundary
// instants for the same reason claude/week.js is.
// ============================================================

import { escHtml } from '../utils.js';
// One set of formatters and one ฝ่าย-colour rule, shared with the calendar.
import {
  hhmm, THAI_DOW, dayStamp, durLabel, pctText, personName, personColor,
} from './fmt.js';

const MIN_MS = 60000;

// ============================================================
// "ใช้ได้เลยตอนนี้" — the question this board is actually opened with
// ============================================================
//
// Nobody books before opening Claude for ten minutes. The question people
// arrive with is the opposite of the one a calendar answers: *I want to use it
// NOW. How much may I take, and until when, without stepping on anyone?*
//
// The arithmetic is claude_free_now() (migration 0155) and none of it is
// repeated here — this renders `board.right_now`. What it adds is the SENTENCE:
// a number with no reason beside it gets argued with, and the reason is
// different depending on which of the two ceilings bound it.
export function paintFreeNow(host, rn, viewingOtherWeek = false) {
  if (!host) return;
  if (!rn) { host.innerHTML = ''; return; }

  const free = Math.max(0, Math.round(Number(rn.free_pct)));
  const pool = rn.session.pool_pct;
  const until = new Date(rn.until);
  const left = until.getTime() - Date.now();
  const measured = rn.week.left_pct != null;

  const tone = free <= 0 ? 'is-none' : free < 25 ? 'is-low' : '';

  // Why this number and not another. One sentence, naming the person when a
  // person is the reason — "someone booked it" is what makes a shared quota
  // feel arbitrary; a name and a purpose is what makes it feel agreed.
  let why;
  if (!measured) {
    why = 'ยังไม่มีข้อมูลการใช้จริงจาก Claude — ตัวเลขนี้คิดจากเซสชัน 5 ชม. อย่างเดียว '
      + 'ยังไม่ได้หักโควตาสัปดาห์ที่ใช้ไปแล้ว';
  } else if (rn.bound_by === 'week') {
    why = `สัปดาห์นี้เหลือ <b>${pctText(rn.week.left_pct)}</b>`
      + (rn.week.reserved_pct
        ? ` และมีคนจองไว้แล้ว <b>${rn.week.reserved_pct}%</b> จึงเหลือให้ใช้โดยไม่ต้องจอง `
          + `<b>${pctText(rn.week.free_pct)}</b>`
        : ' ซึ่งน้อยกว่าโควตาเซสชันหนึ่งรอบ');
  } else if (rn.next_booking) {
    const b = rn.next_booking;
    why = `หลัง ${hhmm(new Date(b.starts_at))} เป็นช่วงที่ `
      + `<b>${escHtml(personName(b.person))}</b> จองไว้ ${b.pct}% `
      + `(${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))})`;
  } else if (rn.session.booked_pct) {
    why = `เซสชัน 5 ชม. รอบนี้ถูกจองไว้แล้ว <b>${rn.session.booked_pct}%</b>`
      + (rn.session.used_pct > 0 ? ` และใช้ไปแล้ว <b>${pctText(rn.session.used_pct)}</b>` : '');
  } else if (rn.session.is_open) {
    why = `เซสชัน 5 ชม. รอบนี้ใช้ไปแล้ว <b>${pctText(rn.session.used_pct)}</b> `
      + `จะขึ้นรอบใหม่เต็ม ${pool}% ตอน ${hhmm(until)}`;
  } else {
    why = `ยังไม่มีใครเปิดเซสชันในช่วงนี้ — เริ่มใช้ตอนนี้จะได้เต็ม ${pool}% `
      + 'ไปอีก 5 ชั่วโมง';
  }

  const live = rn.live_booking;
  const liveNote = live
    ? '<div class="claude-now-live">'
      + '<i class="bi bi-record-circle" aria-hidden="true"></i>'
      + `<span>ตอนนี้อยู่ในช่วงจองของ <b>${escHtml(personName(live.person))}</b> `
      + `(${hhmm(new Date(live.starts_at))}–${hhmm(new Date(live.ends_at))} · ${live.pct}%) `
      + `— ${escHtml(live.purpose)}</span></div>`
    : '';

  host.className = `claude-now ${tone}`;
  host.innerHTML = liveNote
    // The hero is ALWAYS about this instant — that is the whole point of it —
    // so when the grid below is showing some other week it has to say so.
    // Silently correct and apparently about the week on screen is the pairing
    // that produced "in next next week, it still show ใช้ไปแล้วจริง".
    + (viewingOtherWeek
      ? '<div class="claude-now-elsewhere">ตัวเลขนี้คือ<strong>ตอนนี้</strong> '
        + 'ไม่ใช่สัปดาห์ที่กำลังดูอยู่ด้านล่าง</div>'
      : '')
    + '<div class="claude-now-main">'
    + '<div class="claude-now-lead">'
    + '<div class="claude-now-k">ใช้ได้เลยตอนนี้ โดยไม่ต้องจอง</div>'
    + `<div class="claude-now-fig"><span class="claude-now-pct">${free}%</span>`
    + `<span class="claude-now-of">จากเซสชันละ ${pool}%</span></div>`
    + '</div>'
    + '<div class="claude-now-until">'
    + (free > 0
      ? `<div class="claude-now-until-k">ได้ถึง</div>`
        + `<div class="claude-now-until-v">${escHtml(hhmm(until))}</div>`
        + `<div class="claude-now-until-s">${left > 0 ? `อีก ${durLabel(left)}` : 'หมดเวลาแล้ว'}</div>`
      : '<div class="claude-now-until-k">ตอนนี้</div>'
        + '<div class="claude-now-until-v">เต็ม</div>'
        + `<div class="claude-now-until-s">ว่างอีกครั้ง ${escHtml(hhmm(until))}</div>`)
    + '</div>'
    + '</div>'
    + `<div class="claude-now-meter"><i style="width:${Math.min(100, (free / pool) * 100)}%"></i></div>`
    + `<div class="claude-now-why">${why}</div>`;
}


// ============================================================
// The chart
// ============================================================
//
// Two series on ONE axis, which is what makes a shared axis honest here: both
// are a percentage of their own window, 0–100, so a point at 40 means the same
// thing on either line. (Two measures of different scale would need two charts;
// a second y-axis would not be a solution to that, it would be the mistake.)
//
//   • the WEEK, filled — a cumulative climb toward the reset. Its shape answers
//     "are we going to run out before Wednesday".
//   • the 5-HOUR window, a thin line — a sawtooth, because it drops to zero
//     every time Anthropic opens a new one. Its teeth ARE the sessions.
//
// Colour is the app's own: green is the week (the pool this whole feature is
// about) and orange the session, the same two roles they carry everywhere else
// in the brand. Two series, so a legend is present, and each line is labelled
// at its own end as well — identity is never carried by colour alone.
const VB_W = 720;
const VB_H = 150;
const PAD_T = 10;
const PAD_B = 18;

function chartSvg(log, weekStart, weekEnd) {
  const series = Array.isArray(log.series) ? log.series : [];
  const t0 = weekStart.getTime();
  const t1 = weekEnd.getTime();
  const span = t1 - t0;
  if (!span) return '';

  const x = (ms) => ((ms - t0) / span) * VB_W;
  const y = (pct) => PAD_T + (1 - Math.max(0, Math.min(100, Number(pct))) / 100)
    * (VB_H - PAD_T - PAD_B);

  // One day per gridline, drawn from the week's real boundaries rather than a
  // count — the quota week starts mid-afternoon, so its days are not the
  // calendar's days and a loop over 7 would drift by sixteen hours.
  const grid = [];
  for (let t = t0; t <= t1; t += 86400000) {
    const d = new Date(t);
    grid.push(`<line x1="${x(t).toFixed(1)}" y1="${PAD_T}" x2="${x(t).toFixed(1)}"`
      + ` y2="${VB_H - PAD_B}" class="cu-grid"/>`
      + `<text x="${(x(t) + 3).toFixed(1)}" y="${VB_H - 6}" class="cu-axis">`
      + `${THAI_DOW[d.getDay()]} ${d.getDate()}</text>`);
  }

  // Bookings as bands behind the lines: the reason a climb happened, in the
  // same frame as the climb. Behind, and faint, because they are context.
  const bands = (log.entries || []).map((e) => {
    const a = x(new Date(e.starts_at).getTime());
    const b = x(new Date(e.ends_at).getTime());
    return `<rect x="${a.toFixed(1)}" y="${PAD_T}" width="${Math.max(1, b - a).toFixed(1)}"`
      + ` height="${VB_H - PAD_T - PAD_B}" class="cu-band"`
      + ` style="fill:${personColor(e.person)}"><title>${escHtml(personName(e.person))}`
      + ` · ${e.pct}%</title></rect>`;
  }).join('');

  // A gap wider than three polls is the reporter having been DOWN, and joining
  // across it would draw a straight line through hours nobody measured. Break
  // the path instead: an absent line is the honest mark for absent data.
  const GAP_MS = 45 * MIN_MS;
  const runs = [];
  let cur = [];
  series.forEach((row) => {
    const at = Number(row[0]) * 1000;
    if (cur.length && at - cur[cur.length - 1][0] > GAP_MS) { runs.push(cur); cur = []; }
    cur.push([at, row[1], row[2]]);
  });
  if (cur.length) runs.push(cur);

  const path = (idx) => runs.map((run) => run
    .map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[idx]).toFixed(1)}`)
    .join(' ')).join(' ');

  // The week's area needs a floor, so each run closes to the baseline itself.
  const area = runs.map((run) => {
    const d = run.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[2]).toFixed(1)}`)
      .join(' ');
    const x0 = x(run[0][0]).toFixed(1);
    const xn = x(run[run.length - 1][0]).toFixed(1);
    const base = (VB_H - PAD_B).toFixed(1);
    return `${d} L${xn} ${base} L${x0} ${base} Z`;
  }).join(' ');

  const now = Date.now();
  const nowMark = now >= t0 && now <= t1
    ? `<line x1="${x(now).toFixed(1)}" y1="${PAD_T}" x2="${x(now).toFixed(1)}"`
      + ` y2="${VB_H - PAD_B}" class="cu-now"/>` : '';

  // Direct labels at the last point of each line — the selective kind, one per
  // series, not a number on every sample.
  //
  // Nudged apart when the two lines end close together — which is exactly when
  // a label is most needed and least readable. Rendered and looked at: the
  // first version printed "41%" and "32%" on top of each other, because the
  // week and the session happened to end four points apart.
  const last = series.length ? series[series.length - 1] : null;
  const tags = () => {
    if (!last) return '';
    const lx = Math.min(VB_W - 4, x(Number(last[0]) * 1000) + 5);
    const items = [
      { v: last[2], cls: 'cu-tag-week' },
      { v: last[1], cls: 'cu-tag-sess' },
    ].filter((t) => t.v != null).map((t) => ({ ...t, ty: y(t.v) - 4 }));
    if (items.length === 2 && Math.abs(items[0].ty - items[1].ty) < 11) {
      const [hi, lo] = items[0].ty <= items[1].ty ? items : [items[1], items[0]];
      hi.ty -= 5; lo.ty += 6;
    }
    return items.map((t) => `<text x="${lx.toFixed(1)}" y="${t.ty.toFixed(1)}"`
      + ` class="${t.cls}" text-anchor="end">${Math.round(Number(t.v))}%</text>`).join('');
  };

  return `<svg class="cu-chart" viewBox="0 0 ${VB_W} ${VB_H}" role="img"
      aria-label="กราฟการใช้โควตา Claude ตลอดสัปดาห์">
    <line x1="0" y1="${VB_H - PAD_B}" x2="${VB_W}" y2="${VB_H - PAD_B}" class="cu-base"/>
    ${grid.join('')}${bands}
    <path d="${area}" class="cu-area"/>
    <path d="${path(2)}" class="cu-line-week"/>
    <path d="${path(1)}" class="cu-line-sess"/>
    ${nowMark}${tags()}
  </svg>`;
}

// ============================================================
// The panel
// ============================================================

/**
 * Render the whole measured section into `host`.
 *
 * `log` is exactly what get_claude_usage_log() returned. With no samples at all
 * it says so and stops: a page of zeroes reads as a measurement, and the one
 * thing worse than not knowing what was used is believing nothing was.
 */
export function paintUsageLog(host, log) {
  if (!log) { host.innerHTML = ''; return; }

  const weekStart = new Date(log.week.starts_at);
  const weekEnd = new Date(log.week.ends_at);
  const m = log.measured || {};
  const cov = log.coverage || {};

  if (!cov.samples) {
    host.innerHTML = '<div class="claude-measured-off">'
      + '<i class="bi bi-info-circle" aria-hidden="true"></i>'
      + '<div>ยังไม่มีข้อมูลการใช้งานจริงในสัปดาห์นี้ — ตัวเลขทั้งหมดด้านบน'
      + 'คือสิ่งที่จองไว้ ไม่ใช่สิ่งที่ใช้ไปจริง</div></div>';
    return;
  }

  host.innerHTML = [
    reconcileBlock(log, m),
    `<div class="cu-chart-wrap">${chartSvg(log, weekStart, weekEnd)}</div>`,
    chartLegend(),
    entriesBlock(log),
    windowsBlock(log),
    eventsBlock(log),
    coverageBlock(log, m),
  ].join('');
}

/** Booked against measured, for the week on screen. */
function reconcileBlock(log, m) {
  const pool = log.week.pool_pct;
  const booked = log.booked || {};
  const rows = [
    ['ใช้ไปจริงทั้งสัปดาห์', pctText(m.used_pct), 'is-used'],
    ['จองไว้ทั้งสัปดาห์', pctText(booked.total_pct), ''],
    ['วัดได้ว่าอยู่ในช่วงที่มีคนจอง', pctText(m.attributed_pct), ''],
    ['ใช้นอกช่วงที่จอง', pctText(m.unattributed_pct), 'is-loose'],
  ];
  if (m.unlogged_pct > 0) {
    rows.push(['ก่อนเริ่มบันทึก / ช่วงที่ตัวรายงานหยุด', pctText(m.unlogged_pct), 'is-dim']);
  }
  return '<div class="cu-recon">'
    + rows.map(([k, v, cls]) => `<div class="cu-recon-cell ${cls}">`
      + `<div class="cu-recon-v">${escHtml(v)}</div>`
      + `<div class="cu-recon-k">${escHtml(k)}</div></div>`).join('')
    + `<div class="cu-recon-note">ทั้งหมดคิดเป็น % ของเซสชัน — สัปดาห์หนึ่งมี ${pool}%`
    + ' (เท่ากับ 7 เซสชันเต็ม)</div>'
    + '</div>';
}

function chartLegend() {
  return '<div class="cu-legend">'
    + '<span class="cu-legend-item"><i class="cu-key cu-key-week"></i>โควตาสัปดาห์ (สะสมจนถึงรีเซ็ต)</span>'
    + '<span class="cu-legend-item"><i class="cu-key cu-key-sess"></i>เซสชัน 5 ชม. (รีเซ็ตเป็น 0 ทุกครั้งที่ขึ้นรอบใหม่)</span>'
    + '<span class="cu-legend-item"><i class="cu-key cu-key-band"></i>ช่วงที่มีคนจอง</span>'
    + '</div>';
}

/** Per booking: what was claimed, and what the samples say it cost. */
function entriesBlock(log) {
  const entries = log.entries || [];
  if (!entries.length) {
    return '<div class="cu-empty">ยังไม่มีการจองในสัปดาห์นี้ '
      + '— การใช้งานทั้งหมดจึงนับเป็นการใช้นอกช่วงจอง</div>';
  }
  const rows = entries.map((e) => {
    const s = new Date(e.starts_at);
    const en = new Date(e.ends_at);
    const booked = Number(e.pct);
    const used = Number(e.measured_pct);
    // A block that has not run yet has nothing to compare, and printing
    // "ใช้จริง 0%" beside it would read as a person who booked and never showed.
    const future = e.state === 'future';
    const verdict = future
      ? '<span class="cu-chip is-dim">ยังไม่ถึงเวลา</span>'
      : e.state === 'live'
        ? '<span class="cu-chip is-live">กำลังใช้อยู่</span>'
        : used > booked + 1
          ? `<span class="cu-chip is-over">ใช้เกินที่จอง ${pctText(used - booked)}</span>`
          : used < booked - 1
            ? `<span class="cu-chip is-under">ใช้น้อยกว่าจอง ${pctText(booked - used)}</span>`
            : '<span class="cu-chip is-ok">ตรงตามจอง</span>';
    return '<tr>'
      + `<td><span class="cu-dot" style="background:${personColor(e.person)}"></span>`
      + `${escHtml(personName(e.person))}`
      + `<div class="cu-sub">${escHtml(e.purpose || '')}</div></td>`
      + `<td class="cu-num">${escHtml(dayStamp(s))}–${escHtml(hhmm(en))}</td>`
      + `<td class="cu-num">${booked}%</td>`
      + `<td class="cu-num">${future ? '—' : pctText(used)}</td>`
      + `<td>${verdict}</td></tr>`;
  }).join('');

  return '<h6 class="cu-h">การจองแต่ละช่วง — จองไว้เท่าไร ใช้จริงเท่าไร</h6>'
    + '<div class="cu-scroll"><table class="cu-table">'
    + '<thead><tr><th>ใคร</th><th>ช่วงเวลา</th><th class="cu-num">จองไว้</th>'
    + '<th class="cu-num">ใช้จริง</th><th></th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`
    + '<p class="cu-fine">“ใช้จริง” แบ่งตามสัดส่วนเวลาที่การจองนั้นทับกับช่วงที่วัดได้ '
    + 'ส่วนของช่วงเวลาที่ไม่มีใครจอง จะนับเป็นการใช้นอกช่วงจอง ไม่ถูกยกให้ใคร</p>';
}

/** The 5-hour windows that actually happened, peak by peak. */
function windowsBlock(log) {
  const wins = log.windows || [];
  if (!wins.length) return '';
  return '<h6 class="cu-h">เซสชัน 5 ชั่วโมงที่เกิดขึ้นจริง</h6>'
    + '<div class="cu-wins">'
    + wins.map((w) => {
      const a = new Date(w.from);
      const b = new Date(w.to);
      const peak = Number(w.peak_pct);
      const cls = peak >= 90 ? ' is-crit' : peak >= 70 ? ' is-warn' : '';
      return `<div class="cu-win${cls}">`
        + `<div class="cu-win-pct">${Math.round(peak)}%</div>`
        + `<div class="cu-win-meter"><i style="width:${Math.min(100, peak)}%"></i></div>`
        + `<div class="cu-win-when">${escHtml(dayStamp(a))} – ${escHtml(hhmm(b))}`
        + ` · ${escHtml(durLabel(b - a))}</div></div>`;
    }).join('')
    + '</div>'
    + '<p class="cu-fine">วัดจากค่าที่อ่านได้ทุก 15 นาที — ตัวเลขคือจุดสูงสุด'
    + 'ที่เห็นในรอบนั้น ก่อนที่ Claude จะเปิดรอบใหม่</p>';
}

/** The poll log itself, minus the rows where nothing moved. */
function eventsBlock(log) {
  const events = (log.events || []).slice().reverse();
  if (!events.length) return '';
  const byId = new Map((log.entries || []).map((e) => [e.id, e]));
  const rows = events.slice(0, 60).map((ev) => {
    const at = new Date(ev.at);
    if (ev.kind === 'reset') {
      return `<tr class="is-reset"><td class="cu-num">${escHtml(dayStamp(at))}</td>`
        + '<td colspan="2">โควตาสัปดาห์ขึ้นรอบใหม่</td></tr>';
    }
    const who = (ev.booking_ids || [])
      .map((id) => byId.get(id)).filter(Boolean)
      .map((e) => `<span class="cu-dot" style="background:${personColor(e.person)}"></span>`
        + escHtml(personName(e.person)))
      .join(', ');
    return `<tr><td class="cu-num">${escHtml(dayStamp(at))}</td>`
      + `<td class="cu-num"><b>+${pctText(ev.session_pct)}</b></td>`
      + `<td>${who || '<span class="cu-loose">ไม่มีใครจองช่วงนี้</span>'}</td></tr>`;
  }).join('');
  return '<h6 class="cu-h">บันทึกทุก 15 นาที</h6>'
    + '<div class="cu-scroll cu-scroll-tall"><table class="cu-table cu-table-log">'
    + '<thead><tr><th>เวลาที่อ่านค่า</th><th class="cu-num">ใช้เพิ่ม</th>'
    + '<th>ตรงกับการจองของ</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`
    + (events.length > 60
      ? `<p class="cu-fine">แสดง 60 รายการล่าสุด จากทั้งหมด ${events.length}</p>`
      : '<p class="cu-fine">แสดงเฉพาะช่วงที่ตัวเลขขยับ — '
        + 'ช่วงที่ไม่มีการใช้งานจะไม่ขึ้นเป็นแถว</p>');
}

/** Was the reporter actually running? A log nobody checks the coverage of is a
 *  log that can quietly stop. */
function coverageBlock(log, m) {
  const cov = log.coverage || {};
  const gap = Number(cov.max_gap_min || 0);
  const late = gap > 35;
  return '<div class="cu-cov">'
    + `<span>อ่านค่าแล้ว <b>${cov.samples}</b> ครั้งในสัปดาห์นี้ (ทุก ~${cov.interval_min} นาที)</span>`
    + (cov.last_at ? `<span>ล่าสุด ${escHtml(dayStamp(new Date(cov.last_at)))}</span>` : '')
    + `<span class="${late ? 'is-late' : ''}">ช่วงที่ห่างที่สุด ${gap.toFixed(0)} นาที`
    + `${late ? ' — ตัวรายงานเคยหยุดไป' : ''}</span>`
    + (m.unlogged_pct > 0
      ? `<span class="is-dim">มี ${pctText(m.unlogged_pct)} ที่เกิดก่อนบันทึกแรกของสัปดาห์</span>`
      : '')
    + '</div>';
}
