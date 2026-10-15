// ==============================================
// SHOP SALES — what sold, for how much, over a period (admin ยอดขาย tab)
//
// Pure: no DOM, no fetch. It aggregates the SAME rows the orders tab already
// loads (listAllOrders under the admin RLS) — no new read path.
//
// THE COUNTING RULES, each with one home:
//   - which orders count as money  → isRevenueOrder (data.js), the rule behind
//     รายรับสะสม and 0206's shop_order_totals. `cancel` is ignored entirely;
//     the other not-yet-revenue statuses are "รอยืนยัน", shown beside, never in.
//   - a line's money               → unit_price × qty (frozen by place_shop_order),
//     so the product table sums EXACTLY to the KPI. Where an order's total
//     differs from its lines (a fee), the difference is reported, not hidden.
//   - a line's แหล่งที่มา          → its frozen product_source (0058), else the
//     product's current source.
//   - a line's stage               → rowDisplayStatus (data.js), the orders table's.
//   - a line's day                 → placed_at as a Bangkok calendar day (UTC+7,
//     Thailand has no DST).
//   - a line's product             → its product_id. A DELETED product's lines
//     still count; the product row is only for display.
// ==============================================

import {
  isRevenueOrder, rowDisplayStatus, colorLabelFor, findSource, csvCell, bkkTime,
} from './data.js';

export const SALES_PERIODS = [
  { id: '7d',  days: 7,    label: '7 วัน' },
  { id: '30d', days: 30,   label: '30 วัน' },
  { id: '90d', days: 90,   label: '90 วัน' },
  { id: 'all', days: null, label: 'ทั้งหมด' },
];

/** The stages a CONFIRMED line moves through, in order, plus the problem flag.
 *  Labels say what is left to do, which is what the handover bar is for. */
export const HANDOVER_STAGES = [
  { id: 'paid',    label: 'รอผลิต' },
  { id: 'produce', label: 'ผลิตเสร็จ' },
  { id: 'ready',   label: 'ประกาศรับแล้ว' },
  { id: 'done',    label: 'รับสินค้าแล้ว' },
  { id: 'issue',   label: 'มีปัญหา' },
];

const BKK_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' of the Bangkok calendar day an instant falls on ('' if invalid). */
export function bkkDayKey(v) {
  if (v == null || v === '') return '';
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

const keyToUtc = (key) => Date.parse(`${key}T00:00:00Z`);
const utcToKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function addDays(key, n) { return utcToKey(keyToUtc(key) + n * DAY_MS); }
function daysBetween(a, b) { return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS); }
function weekStart(key) {
  const dow = (new Date(keyToUtc(key)).getUTCDay() + 6) % 7;   // Monday = 0
  return addDays(key, -dow);
}
function monthStart(key) { return `${key.slice(0, 7)}-01`; }
function nextMonth(key) {
  const d = new Date(keyToUtc(key));
  return utcToKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** "14 ต.ค." — a short Thai day label for a day key. */
export function thDay(key) {
  const d = new Date(keyToUtc(key));
  return `${d.getUTCDate()} ${TH_MONTHS[d.getUTCMonth()]}`;
}
/** "ต.ค. 69" — month + Buddhist-era year tail. */
export function thMonth(key) {
  const d = new Date(keyToUtc(key));
  return `${TH_MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear() + 543).slice(-2)}`;
}

/** First day (inclusive) of a preset period ending today, or null for 'all'. */
export function periodStartKey(periodId, now = Date.now()) {
  const p = SALES_PERIODS.find((x) => x.id === periodId);
  if (!p || !p.days) return null;
  return addDays(bkkDayKey(now), -(p.days - 1));
}

/** confirmed (money) · pending (not checked yet — shown beside) · void (cancel). */
export function orderSaleState(o) {
  if (!o || o.status === 'cancel') return 'void';
  return isRevenueOrder(o) ? 'confirmed' : 'pending';
}

function buyerKey(o) {
  return o.buyer_id || (o.buyer_email || '').trim().toLowerCase() || (o.buyer_label || '').trim() || `order:${o.id}`;
}

/** Bucket unit for a span of days: daily to two months, weekly to a year. */
export function bucketUnit(spanDays) {
  if (spanDays <= 62) return 'day';
  if (spanDays <= 366) return 'week';
  return 'month';
}

/** Continuous buckets covering [from, to] — empty ones included, so a quiet
 *  week reads as a gap, not as two busy days drawn side by side. */
export function makeBuckets(from, to, unit) {
  const out = [];
  if (!from || !to || from > to) return out;
  let k = unit === 'week' ? weekStart(from) : unit === 'month' ? monthStart(from) : from;
  while (k <= to) {
    const next = unit === 'week' ? addDays(k, 7) : unit === 'month' ? nextMonth(k) : addDays(k, 1);
    const label = unit === 'month' ? thMonth(k) : thDay(k);
    const long = unit === 'week' ? `สัปดาห์ที่เริ่ม ${thDay(k)}` : unit === 'month' ? thMonth(k) : thDay(k);
    out.push({ key: k, end: addDays(next, -1), label, long, revenue: 0, pieces: 0, orders: 0 });
    k = next;
  }
  return out;
}

function bucketIndexFor(buckets, day) {
  // Buckets are sorted and contiguous: a binary search keeps a year of days cheap.
  let lo = 0, hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (day < buckets[mid].key) hi = mid - 1;
    else if (day > buckets[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function sizeOrder(product, sizes) {
  const declared = Array.isArray(product?.sizes) ? product.sizes : [];
  const rank = (s) => { const i = declared.indexOf(s); return i < 0 ? 999 : i; };
  return [...sizes].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}
function colorOrder(product, colors) {
  const declared = (Array.isArray(product?.colors) ? product.colors : []).map((c) => c?.id);
  const rank = (c) => { const i = declared.indexOf(c); return i < 0 ? 999 : i; };
  return [...colors].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

function emptyStages() {
  return Object.fromEntries(HANDOVER_STAGES.map((s) => [s.id, 0]));
}

/**
 * The whole sales picture for one slice.
 * @param {object[]} orders   listAllOrders() rows (each with items[])
 * @param {object[]} products every product, archived ones too
 * @param {{ period?: string, sources?: Iterable<string>, now?: number }} opts
 */
export function salesReport(orders, products, { period = 'all', sources = [], now = Date.now() } = {}) {
  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const sourceSet = new Set(sources || []);
  const today = bkkDayKey(now);
  const from = periodStartKey(period, now);

  const lineSource = (it) => it.product_source || productMap.get(it.product_id)?.source || '';
  const inSlice = (it) => sourceSet.size === 0 || sourceSet.has(lineSource(it));

  const byProduct = new Map();
  const entryFor = (productId) => {
    let e = byProduct.get(productId);
    if (!e) {
      const p = productMap.get(productId) || null;
      e = {
        productId, product: p, name: p?.name || productId, deleted: !p,
        source: p?.source || '', pieces: 0, revenue: 0, orders: new Set(),
        pendingPieces: 0, preorderPieces: 0, stages: emptyStages(),
        cells: new Map(), sizes: new Set(), colors: new Set(),
      };
      byProduct.set(productId, e);
    }
    return e;
  };

  const totals = {
    revenue: 0, pieces: 0, orders: 0, buyers: 0, avgOrder: 0,
    pendingRevenue: 0, pendingOrders: 0, adjustment: 0,
  };
  const stages = emptyStages();
  const confirmedOrders = new Set();
  const buyers = new Set();
  const pendingOrders = new Set();
  const dated = [];            // [day, revenue, pieces, orderId] for the trend
  let firstDay = null;

  for (const o of orders || []) {
    const state = orderSaleState(o);
    if (state === 'void') continue;
    const day = bkkDayKey(o.placed_at);
    if (!day) continue;
    if (from && day < from) continue;
    if (day > today) continue;
    const lines = (Array.isArray(o.items) ? o.items : []).filter(Boolean).filter(inSlice);
    if (!lines.length) continue;
    if (!firstDay || day < firstDay) firstDay = day;

    let orderLines = 0;
    for (const it of lines) {
      const qty = Math.max(0, Number(it.qty) || 0);
      const money = qty * (Number(it.unit_price) || 0);
      orderLines += money;
      const e = entryFor(it.product_id);
      if (state === 'pending') {
        e.pendingPieces += qty;
        totals.pendingRevenue += money;
        continue;
      }
      e.pieces += qty;
      e.revenue += money;
      e.orders.add(o.id);
      if (it.is_preorder) e.preorderPieces += qty;
      const stage = rowDisplayStatus(o, it);
      const st = stage in stages ? stage : 'paid';
      e.stages[st] += qty;
      stages[st] += qty;
      const size = it.size || 'F';
      const color = it.color || 'default';
      e.sizes.add(size); e.colors.add(color);
      const ck = `${size}|${color}`;
      const cell = e.cells.get(ck) || { qty: 0, revenue: 0 };
      cell.qty += qty; cell.revenue += money;
      e.cells.set(ck, cell);
      totals.pieces += qty;
      totals.revenue += money;
      dated.push([day, money, qty, o.id]);
    }
    if (state === 'pending') { pendingOrders.add(o.id); continue; }
    confirmedOrders.add(o.id);
    buyers.add(buyerKey(o));
    // Order total vs its lines — only meaningful when the whole order is in
    // the slice (a source filter splits an order; its fee belongs to nobody).
    if (sourceSet.size === 0) totals.adjustment += (Number(o.total) || 0) - orderLines;
  }

  totals.orders = confirmedOrders.size;
  totals.buyers = buyers.size;
  totals.pendingOrders = pendingOrders.size;
  totals.avgOrder = totals.orders ? Math.round(totals.revenue / totals.orders) : 0;

  // An ACTIVE product that sold nothing in the slice is information too.
  for (const p of products || []) {
    if (!p?.is_active || byProduct.has(p.id)) continue;
    if (sourceSet.size && !sourceSet.has(p.source || '')) continue;
    entryFor(p.id);
  }

  const rows = [...byProduct.values()].map((e) => {
    const sizes = sizeOrder(e.product, e.sizes);
    const colors = colorOrder(e.product, e.colors);
    // The grid's margins: what each size and each colour sold, in pieces AND
    // money — per-size prices mean a size's money is not pieces × one price.
    const sizeTotals = {};
    const colorTotals = {};
    for (const [k, cell] of e.cells) {
      const [size, color] = k.split('|');
      for (const [bag, key] of [[sizeTotals, size], [colorTotals, color]]) {
        const t = bag[key] || (bag[key] = { qty: 0, revenue: 0 });
        t.qty += cell.qty; t.revenue += cell.revenue;
      }
    }
    return {
      productId: e.productId, product: e.product, name: e.name, deleted: e.deleted,
      source: e.source, pieces: e.pieces, revenue: e.revenue, orders: e.orders.size,
      pendingPieces: e.pendingPieces, preorderPieces: e.preorderPieces,
      share: totals.revenue ? e.revenue / totals.revenue : 0,
      stages: e.stages,
      sizes, colors,
      cells: Object.fromEntries(e.cells),
      sizeTotals, colorTotals,
      colorLabels: Object.fromEntries(colors.map((c) => [c, colorLabelFor(e.product, c) || (c === 'default' ? '' : c)])),
    };
  });

  // Trend: from the period start (or the first sale) to today.
  const trendFrom = from || firstDay;
  const unit = trendFrom ? bucketUnit(daysBetween(trendFrom, today) + 1) : 'day';
  const buckets = trendFrom ? makeBuckets(trendFrom, today, unit) : [];
  const bucketOrders = buckets.map(() => new Set());
  for (const [day, money, qty, id] of dated) {
    const i = bucketIndexFor(buckets, day);
    if (i < 0) continue;
    buckets[i].revenue += money;
    buckets[i].pieces += qty;
    bucketOrders[i].add(id);
  }
  buckets.forEach((b, i) => { b.orders = bucketOrders[i].size; });

  return {
    period, from: trendFrom, to: today, unit,
    sources: [...sourceSet],
    totals, stages, buckets,
    products: sortSalesRows(rows, 'revenue'),
  };
}

/** Sort product rows by a column; a zero-sale row always sinks below sales. */
export function sortSalesRows(rows, key = 'revenue', dir = 'desc') {
  const k = ['revenue', 'pieces', 'orders', 'name'].includes(key) ? key : 'revenue';
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const sold = (b.pieces > 0) - (a.pieces > 0);
    if (sold) return sold;
    if (k === 'name') return sign * (a.name || '').localeCompare(b.name || '', 'th');
    return sign * ((a[k] || 0) - (b[k] || 0))
      || (b.revenue - a.revenue)
      || (a.name || '').localeCompare(b.name || '', 'th');
  });
}

/** "1.2K" style for axis ticks; full numbers everywhere a person reads a value. */
export function compactNumber(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(v);
}

/** Up to 3 clean ticks (0, half, top) for a max value: top rounds UP to 1/2/2.5/5×10ⁿ. */
export function niceTicks(max) {
  const m = Math.max(0, Number(max) || 0);
  if (m === 0) return [0, 1];
  const pow = 10 ** Math.floor(Math.log10(m));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= m) * pow;
  return [0, step / 2, step];
}

/** Whole percents of `counts` that sum to exactly 100 (largest remainder);
 *  all zeros for an empty total. */
export function wholePercents(counts) {
  const total = counts.reduce((a, b) => a + (Number(b) || 0), 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => ((Number(c) || 0) / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i] += 1; left -= 1; }
  return out;
}

/** One row per product × size × colour in the slice, for a spreadsheet. */
export function salesCsv(report) {
  const range = report.from ? `${report.from} ถึง ${report.to}` : '';
  const headers = ['สินค้า', 'รหัสสินค้า', 'แหล่งที่มา', 'ไซส์', 'สี', 'ชิ้นที่ขาย', 'รายรับ (บาท)', 'ช่วงเวลา'];
  const rows = [];
  for (const r of report.products) {
    const src = findSource(r.source)?.label || r.source || '';
    if (!r.pieces) {
      rows.push([r.name, r.productId, src, '', '', 0, 0, range].map(csvCell).join(','));
      continue;
    }
    for (const size of r.sizes) {
      for (const color of r.colors) {
        const cell = r.cells[`${size}|${color}`];
        if (!cell) continue;
        rows.push([r.name, r.productId, src, size, r.colorLabels[color] || '', cell.qty, cell.revenue, range]
          .map(csvCell).join(','));
      }
    }
  }
  rows.push(['รวม', '', '', '', '', report.totals.pieces, report.totals.revenue, range].map(csvCell).join(','));
  // UTF-8 BOM so Excel renders Thai; CRLF per RFC 4180 — as the orders export.
  return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
}

/** File stamp for an export, Bangkok time. */
export function salesCsvName(now = new Date()) {
  return `samo-shop-sales-${bkkTime(now).replace(/[: ]/g, '-').slice(0, 16)}.csv`;
}
