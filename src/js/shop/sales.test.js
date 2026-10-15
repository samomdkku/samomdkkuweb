// shop/sales.js — the ยอดขาย tab's counting rules.

import { describe, it, expect } from 'vitest';
import {
  salesReport, bkkDayKey, periodStartKey, makeBuckets, bucketUnit, niceTicks, addDays,
  sortSalesRows, salesCsv, orderSaleState, wholePercents,
} from './sales.js';
import { isRevenueOrder, NOT_YET_REVENUE_STATUSES, STAGES_META } from './data.js';

// 2026-10-15 12:00 Bangkok
const NOW = Date.parse('2026-10-15T05:00:00Z');

const products = [
  { id: 'polo', name: 'Polo', source: 'md', is_active: true,
    sizes: ['S', 'M', 'L'], colors: [{ id: 'g', label: 'เขียว' }, { id: 'b', label: 'ดำ' }] },
  { id: 'pants', name: 'Pants', source: 'mdi', is_active: true, sizes: ['F'], colors: [] },
  { id: 'quiet', name: 'Quiet', source: 'mdi', is_active: true },
  { id: 'old', name: 'Old', source: 'md', is_active: false },
];

let seq = 0;
const line = (product_id, qty, unit_price, extra = {}) => ({
  id: ++seq, product_id, qty, unit_price, size: 'F', color: 'default', item_status: 'paid', ...extra,
});
const order = (id, status, placed_at, items, extra = {}) => ({
  id, status, placed_at, items,
  total: items.reduce((s, it) => s + it.qty * it.unit_price, 0),
  buyer_id: `u-${id}`, ...extra,
});

const ORDERS = [
  order('A', 'paid', '2026-10-14T03:00:00Z', [
    line('polo', 2, 300, { size: 'M', color: 'g', product_source: 'md' }),
    line('pants', 1, 200, { product_source: 'mdi' }),
  ]),
  order('B', 'paid', '2026-10-01T03:00:00Z', [
    line('polo', 1, 300, { size: 'S', color: 'b', product_source: 'md', item_status: 'done', is_preorder: true }),
  ], { buyer_id: 'u-A' }),                                    // same buyer as A
  order('C', 'review', '2026-10-14T04:00:00Z', [line('polo', 5, 300, { product_source: 'md' })]),
  order('D', 'cancel', '2026-10-14T04:00:00Z', [line('polo', 9, 300, { product_source: 'md' })]),
  order('E', 'done', '2026-09-20T03:00:00Z', [line('gone', 3, 100, { product_source: 'md' })]),  // deleted product, legacy status
];

describe('bkkDayKey — a Bangkok calendar day', () => {
  it('rolls 17:00Z over to the next day (UTC+7)', () => {
    expect(bkkDayKey('2026-10-13T16:59:59Z')).toBe('2026-10-13');
    expect(bkkDayKey('2026-10-13T17:00:00Z')).toBe('2026-10-14');
  });
  it('is empty for nothing usable', () => {
    expect(bkkDayKey(null)).toBe('');           // not the epoch: new Date(null) is 1970
    expect(bkkDayKey('')).toBe('');
    expect(bkkDayKey('nope')).toBe('');
  });
});

describe('periodStartKey', () => {
  it('7 วัน = today and the 6 days before it, in Bangkok', () => {
    expect(periodStartKey('7d', NOW)).toBe('2026-10-09');
    expect(periodStartKey('30d', NOW)).toBe('2026-09-16');
    expect(periodStartKey('all', NOW)).toBeNull();
  });
});

describe('order states', () => {
  it('cancel is void, the other not-yet-revenue statuses are pending, the rest confirmed', () => {
    for (const s of Object.keys(STAGES_META)) {
      const want = s === 'cancel' ? 'void' : NOT_YET_REVENUE_STATUSES.includes(s) ? 'pending' : 'confirmed';
      expect(orderSaleState({ status: s }), s).toBe(want);
    }
  });
});

describe('salesReport — all time, every source', () => {
  const r = salesReport(ORDERS, products, { now: NOW });

  it('counts confirmed lines only, cancel ignored, review held aside', () => {
    expect(r.totals.revenue).toBe(600 + 200 + 300 + 300);
    expect(r.totals.pieces).toBe(2 + 1 + 1 + 3);
    expect(r.totals.orders).toBe(3);
    expect(r.totals.buyers).toBe(2);              // A and B are one buyer; E is another
    expect(r.totals.pendingRevenue).toBe(1500);
    expect(r.totals.pendingOrders).toBe(1);
    expect(r.totals.avgOrder).toBe(Math.round(1400 / 3));
  });

  it('DIFFERENTIAL: equals the orders tab\'s รายรับสะสม rule when nothing is filtered', () => {
    const legacy = ORDERS.filter(isRevenueOrder).reduce((s, o) => s + o.total, 0);
    expect(r.totals.revenue + r.totals.adjustment).toBe(legacy);
    expect(r.totals.adjustment).toBe(0);
  });

  it('the product rows sum EXACTLY to the KPIs', () => {
    expect(r.products.reduce((s, p) => s + p.revenue, 0)).toBe(r.totals.revenue);
    expect(r.products.reduce((s, p) => s + p.pieces, 0)).toBe(r.totals.pieces);
  });

  it('a deleted product\'s sales still count', () => {
    const gone = r.products.find((p) => p.productId === 'gone');
    expect(gone).toMatchObject({ deleted: true, pieces: 3, revenue: 300 });
  });

  it('an active product with no sales is listed, an archived one is not', () => {
    expect(r.products.find((p) => p.productId === 'quiet')).toMatchObject({ pieces: 0, revenue: 0 });
    expect(r.products.find((p) => p.productId === 'old')).toBeUndefined();
    expect(r.products.at(-1).pieces).toBe(0);
  });

  it('the size × colour cells sum to the product, in the product\'s own order', () => {
    const polo = r.products.find((p) => p.productId === 'polo');
    expect(polo.sizes).toEqual(['S', 'M']);
    expect(polo.colors).toEqual(['g', 'b']);
    expect(Object.values(polo.cells).reduce((s, c) => s + c.qty, 0)).toBe(polo.pieces);
    expect(polo.colorLabels).toEqual({ g: 'เขียว', b: 'ดำ' });
    // revenue by size and by colour — the grid's margins — sum to the product
    expect(polo.sizeTotals).toEqual({ S: { qty: 1, revenue: 300 }, M: { qty: 2, revenue: 600 } });
    expect(polo.colorTotals).toEqual({ g: { qty: 2, revenue: 600 }, b: { qty: 1, revenue: 300 } });
    expect(Object.values(polo.cells).reduce((s, c) => s + c.revenue, 0)).toBe(polo.revenue);
    expect(polo.pendingPieces).toBe(5);
    expect(polo.preorderPieces).toBe(1);
  });

  it('handover stages use the orders table\'s rule (order status before item status)', () => {
    expect(r.stages).toEqual({ paid: 3, produce: 0, ready: 0, done: 4, issue: 0 });
  });

  it('a fee shows as an adjustment, never folded into a product', () => {
    const withFee = [order('F', 'paid', '2026-10-14T03:00:00Z', [line('pants', 1, 200)], { total: 230 })];
    const rf = salesReport(withFee, products, { now: NOW });
    expect(rf.totals.revenue).toBe(200);
    expect(rf.totals.adjustment).toBe(30);
  });
});

describe('salesReport — slices', () => {
  it('a source filter splits an order by its frozen line source', () => {
    const r = salesReport(ORDERS, products, { now: NOW, sources: ['mdi'] });
    expect(r.totals.revenue).toBe(200);
    expect(r.totals.orders).toBe(1);
    expect(r.totals.adjustment).toBe(0);         // a split order's total belongs to nobody
    expect(r.products.map((p) => p.productId).sort()).toEqual(['pants', 'quiet']);
  });

  it('a period keeps only orders placed on or after its first Bangkok day', () => {
    const r = salesReport(ORDERS, products, { now: NOW, period: '7d' });
    expect(r.totals.revenue).toBe(800);           // only A
    expect(r.from).toBe('2026-10-09');
    expect(r.buckets.length).toBe(7);
  });

  it('the trend is continuous and sums to the KPI', () => {
    const r = salesReport(ORDERS, products, { now: NOW });
    expect(r.unit).toBe('day');
    expect(r.buckets[0].key).toBe('2026-09-20');
    expect(r.buckets.at(-1).key).toBe('2026-10-15');
    expect(r.buckets.reduce((s, b) => s + b.revenue, 0)).toBe(r.totals.revenue);
    expect(r.buckets.reduce((s, b) => s + b.pieces, 0)).toBe(r.totals.pieces);
  });

  it('empty input is an empty report, not a crash', () => {
    const r = salesReport([], [], { now: NOW });
    expect(r.totals.revenue).toBe(0);
    expect(r.buckets).toEqual([]);
    expect(r.products).toEqual([]);
  });
});

describe('buckets', () => {
  it('daily to two months, weekly to a year, monthly beyond', () => {
    expect(bucketUnit(62)).toBe('day');
    expect(bucketUnit(63)).toBe('week');
    expect(bucketUnit(366)).toBe('week');
    expect(bucketUnit(367)).toBe('month');
  });
  it('weeks start on Monday; the first and last are CLAMPED to the range and say so', () => {
    const b = makeBuckets('2026-10-01', '2026-10-15', 'week');   // 1 Oct 2026 is a Thursday
    expect(b[0]).toMatchObject({ key: '2026-10-01', end: '2026-10-04', partial: true });
    expect(b[0].long).toContain('ไม่เต็มสัปดาห์');
    expect(b[1]).toMatchObject({ key: '2026-10-05', end: '2026-10-11', partial: false });
    expect(b.at(-1)).toMatchObject({ key: '2026-10-12', end: '2026-10-15', partial: true });
    for (let i = 1; i < b.length; i++) expect(b[i].key).toBe(addDays(b[i - 1].end, 1));
  });
  it('months roll over the year, clamped at both ends', () => {
    const b = makeBuckets('2026-12-15', '2027-01-02', 'month');
    expect(b.map((x) => [x.key, x.end])).toEqual([['2026-12-15', '2026-12-31'], ['2027-01-01', '2027-01-02']]);
  });
});

describe('niceTicks', () => {
  it('rounds the top up to a clean number', () => {
    expect(niceTicks(1830)).toEqual([0, 1000, 2000]);
    expect(niceTicks(240)).toEqual([0, 125, 250]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it('pieces never get a half-piece gridline', () => {
    expect(niceTicks(1, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(3, { integer: true })).toEqual([0, 5]);
    expect(niceTicks(8, { integer: true })).toEqual([0, 5, 10]);
  });
});

describe('sortSalesRows', () => {
  it('zero-sale rows always sink, whatever the column', () => {
    const rows = [{ name: 'z', pieces: 0, revenue: 0, orders: 0 }, { name: 'a', pieces: 1, revenue: 5, orders: 1 }];
    expect(sortSalesRows(rows, 'pieces', 'asc')[0].name).toBe('a');
    expect(sortSalesRows(rows, 'name', 'desc')[0].name).toBe('a');
  });
});

describe('salesCsv', () => {
  it('one row per variant, a total row, Thai colour labels, formula-safe names', () => {
    const evil = [{ id: 'x', name: '=HYPERLINK("a")', source: 'md', is_active: true }];
    const r = salesReport([order('X', 'paid', '2026-10-14T03:00:00Z', [line('x', 2, 50)])], evil, { now: NOW });
    const csv = salesCsv(r);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""a"")"`);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"รวม"');
    expect(lines[2]).toContain(',2,100,');
  });
});

describe('wholePercents', () => {
  it('always sums to 100 (3 of 8 and 5 of 8 were 38% + 63%)', () => {
    expect(wholePercents([3, 5])).toEqual([38, 62]);   // a tie goes to the earlier stage
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholePercents([0, 4, 0])).toEqual([0, 100, 0]);
    expect(wholePercents([0, 0])).toEqual([0, 0]);
  });
});

describe('per-size money', () => {
  it('a size priced higher earns more than its share of pieces', () => {
    const lines = [line('polo', 2, 299, { size: 'M', color: 'g' }), line('polo', 1, 329, { size: 'L', color: 'g' })];
    const r = salesReport([order('P', 'paid', '2026-10-14T03:00:00Z', lines)], products, { now: NOW });
    const polo = r.products.find((p) => p.productId === 'polo');
    expect(polo.sizeTotals.M).toEqual({ qty: 2, revenue: 598 });
    expect(polo.sizeTotals.L).toEqual({ qty: 1, revenue: 329 });
    expect(polo.cells['L|g'].revenue).toBe(329);
  });
});

describe('review-round fixes (2026-10-15)', () => {
  it('a rejected slip or no slip is NOT "waiting for a slip check" — only review is', () => {
    const r = salesReport([
      order('M', 'slip_mismatch', '2026-10-14T03:00:00Z', [line('polo', 1, 500)]),
      order('P', 'pending', '2026-10-14T03:00:00Z', [line('polo', 1, 100)]),
      order('R', 'review', '2026-10-14T03:00:00Z', [line('polo', 2, 300)]),
    ], products, { now: NOW });
    expect(r.totals).toMatchObject({ pendingOrders: 3, pendingRevenue: 1200, reviewOrders: 1, reviewRevenue: 600 });
    const polo = r.products.find((p) => p.productId === 'polo');
    expect(polo).toMatchObject({ pendingPieces: 4, reviewPieces: 2 });
  });

  it('a row\'s แหล่งที่มา is the one its counted lines were filtered by', () => {
    const moved = [{ ...products[0], source: 'rt' }];          // polo moved to RT after the sale
    const r = salesReport([order('S', 'paid', '2026-10-14T03:00:00Z', [line('polo', 1, 300, { product_source: 'md' })])],
      moved, { now: NOW, sources: ['md'] });
    expect(r.products[0]).toMatchObject({ productId: 'polo', source: 'md' });
    expect(salesCsv(r)).toContain('"MD"');
    expect(salesCsv(r)).not.toContain('"RT"');
  });

  it('an old line carrying the colour LABEL lands in the same grid row as the id', () => {
    const r = salesReport([order('C', 'paid', '2026-10-14T03:00:00Z', [
      line('polo', 1, 300, { size: 'M', color: 'g' }),
      line('polo', 2, 300, { size: 'M', color: 'เขียว' }),
    ])], products, { now: NOW });
    const polo = r.products.find((p) => p.productId === 'polo');
    expect(polo.colors).toEqual(['g']);
    expect(polo.cells['M|g']).toEqual({ qty: 3, revenue: 900 });
  });

  it('the CSV explains a fee the same way the page does', () => {
    const r = salesReport([order('F', 'paid', '2026-10-14T03:00:00Z', [line('pants', 1, 200)], { total: 230 })], products, { now: NOW });
    const rows = salesCsv(r).split('\r\n');
    expect(rows.some((x) => x.includes('ค่าธรรมเนียม') && x.includes(',30,'))).toBe(true);
    expect(rows.at(-1)).toContain(',230,');
  });

  it('an order stamped after this device\'s "today" (clock behind) still counts', () => {
    const r = salesReport([order('T', 'paid', '2026-10-15T17:30:00Z', [line('pants', 1, 200)])], products, { now: NOW });
    expect(r.totals.revenue).toBe(200);
    expect(r.to).toBe('2026-10-16');
    expect(r.buckets.at(-1).revenue).toBe(200);
  });
});
