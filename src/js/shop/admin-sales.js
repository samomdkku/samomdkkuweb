// ==============================================
// SHOP ADMIN — ยอดขาย (sales) tab
//
// What each product sold, for how much, over a period and per แหล่งที่มา.
// Every number comes from salesReport (sales.js) — this file only draws it.
// The filter row is static markup in tab-admin.html so it keeps focus across
// re-renders; everything below it is redrawn from one report, so the KPI, the
// product rows, the trend and the handover bar always agree.
// ==============================================

import { escHtml } from '../utils.js';
import { thb, findSource, SHOP_SOURCES, thumbStyle } from './data.js';
import {
  salesReport, sortSalesRows, salesCsv, salesCsvName, niceTicks, compactNumber,
  HANDOVER_STAGES, SALES_PERIODS, thDay, wholePercents,
} from './sales.js';

const PERIOD_KEY = 'samoshop.admin.salesPeriod';

const view = {
  period: 'all',
  sources: new Set(),
  metric: 'revenue',          // trend: 'revenue' | 'pieces'
  sort: { key: 'revenue', dir: 'desc' },
  expanded: new Set(),
  report: null,
  orders: [],
  products: [],
  wired: false,
  hooks: { onShowOrders: null, onVerify: null, toast: null },
};

function loadPeriod() {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    return SALES_PERIODS.some((p) => p.id === v) ? v : 'all';
  } catch { return 'all'; }
}
function savePeriod(v) {
  try { localStorage.setItem(PERIOD_KEY, v); } catch { /* private mode — non-fatal */ }
}

/**
 * Mount once. `hooks.onShowOrders(productId)` jumps to the orders tab filtered
 * to one product; `hooks.onVerify()` opens the slip queue.
 */
export function initSales({ sources = [], onShowOrders, onVerify, toast } = {}) {
  view.hooks = { onShowOrders, onVerify, toast };
  if (view.wired) return;
  view.wired = true;
  view.period = loadPeriod();
  view.sources = new Set(sources);

  const filters = document.getElementById('shopSalesFilters');
  filters?.addEventListener('click', (e) => {
    const p = e.target.closest('[data-sales-period]');
    if (p) {
      view.period = p.dataset.salesPeriod;
      savePeriod(view.period);
      recompute();
      return;
    }
    const s = e.target.closest('[data-sales-source]');
    if (s) {
      const id = s.dataset.salesSource;
      if (id === 'all') view.sources.clear();
      else if (view.sources.has(id)) view.sources.delete(id);
      else view.sources.add(id);
      recompute();
    }
  });
  document.getElementById('shopSalesExport')?.addEventListener('click', exportCsv);

  const body = document.getElementById('shopSalesBody');
  body?.addEventListener('click', onBodyClick);
}

/** Show a loading state over the previous render — never a blank or a jump. */
export function setSalesLoading(on) {
  document.getElementById('shopSalesBody')?.classList.toggle('is-loading', !!on);
}

/** New data in; redraw everything. */
export function renderSales(orders, products) {
  view.orders = orders || [];
  view.products = products || [];
  setSalesLoading(false);
  recompute();
}

function recompute() {
  view.report = salesReport(view.orders, view.products, { period: view.period, sources: view.sources });
  renderFilters();
  renderBody();
}

// ── filter row ────────────────────────────────────────────────────────
function renderFilters() {
  document.querySelectorAll('#shopSalesFilters [data-sales-period]').forEach((b) => {
    const on = b.dataset.salesPeriod === view.period;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const host = document.getElementById('shopSalesSources');
  if (!host) return;
  // Only sources that own a product or appear on a line — a chip that can
  // only ever say "nothing" is noise.
  const present = new Set(view.products.map((p) => p.source).filter(Boolean));
  for (const o of view.orders) for (const it of o.items || []) if (it?.product_source) present.add(it.product_source);
  const list = SHOP_SOURCES.filter((s) => s.id !== 'all' && (present.has(s.id) || view.sources.has(s.id)));
  if (list.length < 2 && view.sources.size === 0) { host.innerHTML = ''; return; }
  const chip = (id, label, color, on) => `
    <button type="button" class="sales-chip ${on ? 'is-active' : ''}" data-sales-source="${escHtml(id)}" aria-pressed="${on}">
      ${color ? `<span class="sales-dot" style="background:${escHtml(color)}"></span>` : ''}${escHtml(label)}
    </button>`;
  host.innerHTML = chip('all', 'ทุกแหล่ง', '', view.sources.size === 0)
    + list.map((s) => chip(s.id, s.label, s.color, view.sources.has(s.id))).join('');
}

// ── body ──────────────────────────────────────────────────────────────
function periodPhrase(r) {
  const p = SALES_PERIODS.find((x) => x.id === r.period);
  if (!r.from) return p?.id === 'all' ? 'ทั้งหมด' : `${p?.label || ''}ที่ผ่านมา`;
  const range = r.from === r.to ? thDay(r.from) : `${thDay(r.from)} – ${thDay(r.to)}`;
  return p?.id === 'all' ? `ทั้งหมด · ${range}` : `${p.label}ที่ผ่านมา · ${range}`;
}

function renderBody() {
  const host = document.getElementById('shopSalesBody');
  if (!host) return;
  const r = view.report;
  const anyOrders = view.orders.some((o) => o.status !== 'cancel');

  if (!anyOrders) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-graph-up-arrow"></i>
        <h4>ยังไม่มียอดขาย</h4>
        <p>เมื่อมีคำสั่งซื้อที่ตรวจสลิปแล้ว ยอดขายแต่ละสินค้าจะแสดงที่นี่</p>
      </div>`;
    return;
  }

  const t = r.totals;
  const nothingHere = t.pieces === 0 && t.pendingOrders === 0;
  host.innerHTML = `
    ${kpisHtml(r)}
    ${pendingHtml(r)}
    ${nothingHere ? emptyPeriodHtml(r) : `
      ${productsHtml(r)}
      ${t.pieces ? trendHtml(r) : ''}
      ${t.pieces ? handoverHtml(r.stages, t.pieces, 'การส่งมอบ', 'ชิ้นที่ขายแล้ว อยู่ขั้นไหน — ดูว่าเหลือต้องผลิตหรือแจกอีกเท่าไร') : ''}
    `}`;
  wireTrend(host);
}

function kpisHtml(r) {
  const t = r.totals;
  const kpi = (label, value, suffix = '') => `
    <div class="sales-kpi">
      <div class="sales-kpi-label">${label}</div>
      <div class="sales-kpi-value">${value}${suffix ? `<span class="sales-kpi-suffix">${suffix}</span>` : ''}</div>
    </div>`;
  return `
    <section class="sales-kpis" aria-label="สรุปยอดขาย">
      <div class="sales-hero">
        <div class="sales-kpi-label">รายรับ</div>
        <div class="sales-hero-value">฿${thb(t.revenue)}</div>
        <div class="sales-hero-sub">${escHtml(periodPhrase(r))}</div>
      </div>
      ${kpi('ชิ้นที่ขาย', thb(t.pieces), 'ชิ้น')}
      ${kpi('คำสั่งซื้อ', thb(t.orders), 'ออเดอร์')}
      ${kpi('ผู้ซื้อ', thb(t.buyers), 'คน')}
      ${kpi('เฉลี่ยต่อออเดอร์', `฿${thb(t.avgOrder)}`)}
    </section>`;
}

function pendingHtml(r) {
  const t = r.totals;
  if (!t.pendingOrders) return '';
  return `
    <div class="sales-note">
      <i class="bi bi-hourglass-split" aria-hidden="true"></i>
      <div>
        อีก <b>฿${thb(t.pendingRevenue)}</b> จาก ${thb(t.pendingOrders)} ออเดอร์ยังไม่ได้ตรวจสลิป — ยังไม่นับในรายรับ
      </div>
      ${view.hooks.onVerify ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-sales-verify>ไปตรวจสลิป</button>' : ''}
    </div>`;
}

function emptyPeriodHtml(r) {
  return `
    <div class="empty-state sales-empty">
      <i class="bi bi-calendar2-x"></i>
      <h4>ไม่มียอดขายในช่วงนี้</h4>
      <p>${escHtml(periodPhrase(r))}${view.sources.size ? ' · เฉพาะแหล่งที่เลือก' : ''}</p>
      ${r.period !== 'all' ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-sales-period-jump="all">ดูทั้งหมด</button>' : ''}
    </div>`;
}

// ── per product ───────────────────────────────────────────────────────
function productsHtml(r) {
  const rows = sortSalesRows(r.products, view.sort.key, view.sort.dir);
  const head = (key, label, cls = '') => {
    const on = view.sort.key === key;
    const dirWord = on ? (view.sort.dir === 'asc' ? ' (น้อยไปมาก)' : ' (มากไปน้อย)') : '';
    return `<button type="button" class="sales-sort ${cls} ${on ? 'is-active' : ''}" data-sales-sort="${key}"
      aria-pressed="${on}" aria-label="เรียงตาม${label}${dirWord}">
      ${label}<i class="bi ${on && view.sort.dir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down'}" aria-hidden="true"></i></button>`;
  };
  const adj = r.totals.adjustment;
  return `
    <section class="sales-card" aria-labelledby="salesProductsTitle">
      <header class="sales-card-head">
        <div>
          <h6 class="sales-card-title" id="salesProductsTitle">แยกตามสินค้า</h6>
          <p class="sales-card-sub">กดที่สินค้าเพื่อดูไซส์ · สี และการส่งมอบ</p>
        </div>
      </header>
      <div class="sales-table">
        <div class="sales-thead">
          ${head('name', 'สินค้า', 'is-name')}
          ${head('pieces', 'ชิ้น')}
          ${head('orders', 'ออเดอร์')}
          ${head('revenue', 'รายรับ')}
          <span class="sales-th-share">สัดส่วน</span>
        </div>
        ${rows.map(productRowHtml).join('')}
        <div class="sales-tfoot">
          <span class="is-name">รวม</span>
          <span class="sales-num">${thb(r.totals.pieces)}</span>
          <span class="sales-num">${thb(r.totals.orders)}</span>
          <span class="sales-num">฿${thb(r.totals.revenue)}</span>
          <span class="sales-th-share"></span>
        </div>
      </div>
      ${adj ? `<p class="sales-foot-note">ยอดตามคำสั่งซื้อ${adj > 0 ? 'มากกว่า' : 'น้อยกว่า'}ผลรวมสินค้า ฿${thb(Math.abs(adj))} (ค่าธรรมเนียมหรือการปรับยอดในคำสั่งซื้อ)</p>` : ''}
    </section>`;
}

function productRowHtml(row) {
  const open = view.expanded.has(row.productId);
  const src = findSource(row.source);
  const pct = Math.round(row.share * 1000) / 10;
  const meta = [
    src ? `<span class="sales-meta"><span class="sales-dot" style="background:${escHtml(src.color || 'var(--shop-ink-300)')}"></span>${escHtml(src.label)}</span>` : '',
    row.deleted ? '<span class="sales-meta">สินค้าถูกลบแล้ว</span>' : '',
    row.product && !row.product.is_active ? '<span class="sales-meta">ปิดการขายแล้ว</span>' : '',
    row.preorderPieces ? `<span class="sales-meta">พรีออเดอร์ ${thb(row.preorderPieces)}</span>` : '',
    row.pendingPieces ? `<span class="sales-meta is-pending">รอตรวจสลิป ${thb(row.pendingPieces)} ชิ้น</span>` : '',
  ].filter(Boolean).join('');
  const zero = row.pieces === 0;
  const panelId = `salesPanel-${cssId(row.productId)}`;
  return `
    <div class="sales-row-wrap ${open ? 'is-open' : ''} ${zero ? 'is-zero' : ''}">
      <button type="button" class="sales-row" data-sales-toggle="${escHtml(row.productId)}"
              aria-expanded="${open}" aria-controls="${panelId}">
        <span class="is-name sales-name-cell">
          <span class="sales-thumb" style="${row.product ? thumbStyle(row.product, null, 200) : ''}" aria-hidden="true"></span>
          <span class="sales-name-text">
            <span class="sales-name">${escHtml(row.name)}</span>
            <span class="sales-metas">${zero && !row.pendingPieces ? '<span class="sales-meta">ยังไม่มียอดขาย</span>' : ''}${meta}</span>
          </span>
        </span>
        <span class="sales-num" data-label="ชิ้น">${zero ? '' : thb(row.pieces)}</span>
        <span class="sales-num" data-label="ออเดอร์">${zero ? '–' : thb(row.orders)}</span>
        <span class="sales-num sales-revenue">${zero ? '–' : `฿${thb(row.revenue)}`}</span>
        <span class="sales-share" aria-label="สัดส่วน ${pct}%">
          <span class="sales-share-track"><span class="sales-share-fill" style="width:${Math.max(0, Math.min(100, row.share * 100))}%"></span></span>
          <span class="sales-share-pct">${zero ? '' : `${pct}%`}</span>
        </span>
        <i class="bi bi-chevron-down sales-chevron" aria-hidden="true"></i>
      </button>
      ${open ? `<div class="sales-panel" id="${panelId}">${panelHtml(row)}</div>` : ''}
    </div>`;
}

function cssId(s) { return String(s).replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`); }

function panelHtml(row) {
  if (!row.pieces) {
    return `<p class="sales-panel-empty">${row.pendingPieces ? 'มีคำสั่งซื้อรอตรวจสลิป — จะนับเมื่ออนุมัติแล้ว' : 'ยังไม่มีคำสั่งซื้อในช่วงนี้'}</p>
      ${showOrdersBtn(row)}`;
  }
  const single = row.sizes.length === 1 && row.colors.length === 1;
  return `
    <div class="sales-panel-grid">
      <div>
        <div class="sales-panel-label">ไซส์ × สี <span class="text-muted">(ชิ้น)</span></div>
        ${single ? `<p class="sales-panel-empty">แบบเดียว · ${thb(row.pieces)} ชิ้น</p>` : matrixHtml(row)}
      </div>
      <div>
        ${handoverHtml(row.stages, row.pieces, 'การส่งมอบ', '', true)}
        ${showOrdersBtn(row)}
      </div>
    </div>`;
}

function showOrdersBtn(row) {
  if (!view.hooks.onShowOrders || row.deleted) return '';
  return `<button type="button" class="btn btn-sm btn-outline-secondary mt-2" data-sales-orders="${escHtml(row.productId)}">
    <i class="bi bi-list-check me-1" aria-hidden="true"></i>ดูคำสั่งซื้อของสินค้านี้</button>`;
}

/** Sizes across, colours down; each cell tinted by its share of the busiest
 *  cell — one hue, light → dark (sequential), the number always printed. */
function matrixHtml(row) {
  const max = Math.max(1, ...Object.values(row.cells).map((c) => c.qty));
  const colors = row.colors;
  const sizes = row.sizes;
  const sizeTotal = (s) => colors.reduce((a, c) => a + (row.cells[`${s}|${c}`]?.qty || 0), 0);
  const colorTotal = (c) => sizes.reduce((a, s) => a + (row.cells[`${s}|${c}`]?.qty || 0), 0);
  const colorHex = (c) => (row.product?.colors || []).find((x) => x?.id === c)?.hex;
  const cell = (s, c) => {
    const q = row.cells[`${s}|${c}`]?.qty || 0;
    if (!q) return '<td class="is-empty">·</td>';
    const mix = Math.round(12 + 58 * (q / max));
    return `<td style="--mix:${mix}%" class="${mix > 48 ? 'is-strong' : ''}">${thb(q)}</td>`;
  };
  return `
    <div class="sales-matrix-scroll">
      <table class="sales-matrix">
        <thead><tr><th scope="col"></th>${sizes.map((s) => `<th scope="col">${escHtml(s === 'F' ? 'ฟรีไซส์' : s)}</th>`).join('')}<th scope="col" class="is-total">รวม</th></tr></thead>
        <tbody>
          ${colors.map((c) => `
            <tr>
              <th scope="row">${colorHex(c) ? `<span class="sales-swatch" style="background:${escHtml(colorHex(c))}"></span>` : ''}${escHtml(row.colorLabels[c] || 'มาตรฐาน')}</th>
              ${sizes.map((s) => cell(s, c)).join('')}
              <td class="is-total">${thb(colorTotal(c))}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr><th scope="row">รวม</th>${sizes.map((s) => `<td>${thb(sizeTotal(s))}</td>`).join('')}<td class="is-total">${thb(row.pieces)}</td></tr></tfoot>
      </table>
    </div>`;
}

/** One stacked bar for an ordered progression, labelled — never colour alone. */
function handoverHtml(stages, total, title, sub, compact = false) {
  const segs = HANDOVER_STAGES.filter((s) => stages[s.id] > 0);
  // Whole percents that add up to exactly 100 (38 + 63 read as a bug).
  const pcts = wholePercents(HANDOVER_STAGES.map((s) => stages[s.id]));
  const legend = HANDOVER_STAGES
    .map((s, i) => ({ ...s, n: stages[s.id], pct: pcts[i] }))
    .filter((s) => s.n > 0 || (!compact && s.id !== 'issue'));
  const body = `
    <div class="sales-stack" role="img" aria-label="${escHtml(segs.map((s) => `${s.label} ${stages[s.id]} ชิ้น`).join(', '))}">
      ${segs.map((s) => `<span class="sales-seg" data-stage="${s.id}" style="flex-grow:${stages[s.id]}"></span>`).join('')}
    </div>
    <ul class="sales-legend">
      ${legend.map((s) => `
        <li><span class="sales-key" data-stage="${s.id}"></span>
          <span class="sales-legend-label">${escHtml(s.label)}</span>
          <b>${thb(s.n)}</b><span class="text-muted">${s.n ? ` · ${s.pct}%` : ''}</span></li>`).join('')}
    </ul>`;
  if (compact) return `<div class="sales-panel-label">${escHtml(title)}</div>${body}`;
  return `
    <section class="sales-card">
      <header class="sales-card-head"><div>
        <h6 class="sales-card-title">${escHtml(title)}</h6>
        ${sub ? `<p class="sales-card-sub">${escHtml(sub)}</p>` : ''}
      </div></header>
      ${body}
    </section>`;
}

// ── trend ─────────────────────────────────────────────────────────────
const UNIT_TITLE = { day: 'รายวัน', week: 'รายสัปดาห์', month: 'รายเดือน' };

function trendHtml(r) {
  const m = view.metric;
  const vals = r.buckets.map((b) => b[m]);
  const ticks = niceTicks(Math.max(...vals, 0));
  const top = ticks[ticks.length - 1];
  const n = r.buckets.length;
  const labelIdx = xLabelIndexes(n);
  const fmt = (v) => (m === 'revenue' ? `฿${thb(v)}` : `${thb(v)} ชิ้น`);
  const best = r.buckets.reduce((a, b) => (b[m] > (a?.[m] ?? -1) ? b : a), null);
  return `
    <section class="sales-card" aria-labelledby="salesTrendTitle">
      <header class="sales-card-head">
        <div>
          <h6 class="sales-card-title" id="salesTrendTitle">${m === 'revenue' ? 'รายรับ' : 'ชิ้นที่ขาย'}${UNIT_TITLE[r.unit]}</h6>
          <p class="sales-card-sub">${best && best[m] ? `สูงสุด ${escHtml(best.long)} · ${fmt(best[m])}` : ''}</p>
        </div>
        <div class="sales-seg-ctl" role="group" aria-label="แสดงเป็น">
          <button type="button" data-sales-metric="revenue" class="${m === 'revenue' ? 'is-active' : ''}" aria-pressed="${m === 'revenue'}">บาท</button>
          <button type="button" data-sales-metric="pieces" class="${m === 'pieces' ? 'is-active' : ''}" aria-pressed="${m === 'pieces'}">ชิ้น</button>
        </div>
      </header>
      <div class="sales-chart">
        <div class="sales-plot" tabindex="0" role="img"
             aria-label="${escHtml(`กราฟ${m === 'revenue' ? 'รายรับ' : 'ชิ้นที่ขาย'}${UNIT_TITLE[r.unit]} ใช้ลูกศรซ้ายขวาเพื่ออ่านค่า`)}">
          ${ticks.map((v) => `<div class="sales-gridline" style="bottom:${(v / top) * 100}%"><span>${m === 'revenue' ? compactNumber(v) : thb(v)}</span></div>`).join('')}
          <div class="sales-cols ${n > 45 ? 'is-dense' : ''}">
            ${r.buckets.map((b, i) => `
              <div class="sales-col" data-i="${i}">
                <span class="sales-bar" style="height:${top ? (b[m] / top) * 100 : 0}%${b[m] > 0 ? ';min-height:2px' : ''}"></span>
              </div>`).join('')}
          </div>
          <div class="sales-tip" role="status" aria-live="polite" hidden></div>
        </div>
        <div class="sales-xaxis" aria-hidden="true">
          ${labelIdx.map((i) => `<span style="left:${((i + 0.5) / n) * 100}%">${escHtml(r.buckets[i].label)}</span>`).join('')}
        </div>
      </div>
      <details class="sales-details">
        <summary>ดูเป็นตาราง</summary>
        <table class="table table-sm sales-data-table">
          <thead><tr><th>${r.unit === 'day' ? 'วัน' : r.unit === 'week' ? 'สัปดาห์' : 'เดือน'}</th><th class="text-end">ออเดอร์</th><th class="text-end">ชิ้น</th><th class="text-end">รายรับ</th></tr></thead>
          <tbody>${r.buckets.filter((b) => b.pieces).map((b) => `
            <tr><td>${escHtml(b.long)}</td><td class="text-end">${thb(b.orders)}</td><td class="text-end">${thb(b.pieces)}</td><td class="text-end">฿${thb(b.revenue)}</td></tr>`).join('')}
          </tbody>
        </table>
      </details>
    </section>`;
}

/** Up to ~5 evenly spread x labels, always the first and the last. */
function xLabelIndexes(n) {
  if (n <= 0) return [];
  if (n <= 5) return [...Array(n).keys()];
  const k = 4;
  const out = new Set([0, n - 1]);
  for (let j = 1; j < k; j++) out.add(Math.round((j * (n - 1)) / k));
  return [...out].sort((a, b) => a - b);
}

/** Hover / touch / arrow keys: the pointer only has to be in the column's
 *  band, not on its bar (a 3px bar is a target nobody hits). */
function wireTrend(host) {
  const plot = host.querySelector('.sales-plot');
  if (!plot) return;
  const r = view.report;
  const cols = [...plot.querySelectorAll('.sales-col')];
  const tip = plot.querySelector('.sales-tip');
  let cur = -1;
  const show = (i) => {
    if (i < 0 || i >= cols.length) return;
    if (cur >= 0) cols[cur]?.classList.remove('is-hot');
    cur = i;
    cols[i].classList.add('is-hot');
    const b = r.buckets[i];
    tip.replaceChildren();
    const v = document.createElement('div');
    v.className = 'sales-tip-value';
    v.textContent = view.metric === 'revenue' ? `฿${thb(b.revenue)}` : `${thb(b.pieces)} ชิ้น`;
    const l = document.createElement('div');
    l.className = 'sales-tip-label';
    l.textContent = `${b.long} · ${thb(b.orders)} ออเดอร์${view.metric === 'revenue' ? ` · ${thb(b.pieces)} ชิ้น` : ` · ฿${thb(b.revenue)}`}`;
    tip.append(v, l);
    tip.hidden = false;
    const pr = plot.getBoundingClientRect();
    const cr = cols[i].getBoundingClientRect();
    const center = cr.left + cr.width / 2 - pr.left;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(pr.width - half, center))}px`;
  };
  const hide = () => {
    if (cur >= 0) cols[cur]?.classList.remove('is-hot');
    cur = -1;
    tip.hidden = true;
  };
  const indexAt = (clientX) => {
    const pr = plot.querySelector('.sales-cols').getBoundingClientRect();
    return Math.max(0, Math.min(cols.length - 1, Math.floor(((clientX - pr.left) / pr.width) * cols.length)));
  };
  plot.addEventListener('pointermove', (e) => show(indexAt(e.clientX)));
  plot.addEventListener('pointerdown', (e) => show(indexAt(e.clientX)));
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  plot.addEventListener('pointercancel', hide);
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    const last = cols.length - 1;
    const map = { ArrowLeft: cur < 0 ? last : cur - 1, ArrowRight: cur < 0 ? 0 : cur + 1, Home: 0, End: last };
    if (!(e.key in map)) { if (e.key === 'Escape') hide(); return; }
    e.preventDefault();
    show(Math.max(0, Math.min(last, map[e.key])));
  });
}

// ── events ────────────────────────────────────────────────────────────
function onBodyClick(e) {
  const t = e.target;
  const toggle = t.closest('[data-sales-toggle]');
  if (toggle) {
    const id = toggle.dataset.salesToggle;
    if (view.expanded.has(id)) view.expanded.delete(id); else view.expanded.add(id);
    renderBody();
    document.querySelector(`[data-sales-toggle="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    return;
  }
  const sort = t.closest('[data-sales-sort]');
  if (sort) {
    const key = sort.dataset.salesSort;
    view.sort = view.sort.key === key
      ? { key, dir: view.sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' };
    renderBody();
    document.querySelector(`[data-sales-sort="${key}"]`)?.focus({ preventScroll: true });
    return;
  }
  const metric = t.closest('[data-sales-metric]');
  if (metric) {
    view.metric = metric.dataset.salesMetric;
    renderBody();
    document.querySelector(`[data-sales-metric="${view.metric}"]`)?.focus({ preventScroll: true });
    return;
  }
  const jump = t.closest('[data-sales-period-jump]');
  if (jump) { view.period = jump.dataset.salesPeriodJump; savePeriod(view.period); recompute(); return; }
  const orders = t.closest('[data-sales-orders]');
  if (orders) { view.hooks.onShowOrders?.(orders.dataset.salesOrders); return; }
  if (t.closest('[data-sales-verify]')) view.hooks.onVerify?.();
}

function exportCsv() {
  const r = view.report;
  if (!r || (!r.totals.pieces && !r.products.length)) {
    view.hooks.toast?.('ไม่มียอดขายในช่วงที่เลือก', 'warn');
    return;
  }
  const blob = new Blob([salesCsv(r)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = salesCsvName();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  view.hooks.toast?.(`ส่งออกยอดขาย ${r.products.filter((p) => p.pieces).length} สินค้าแล้ว`, 'success');
}
