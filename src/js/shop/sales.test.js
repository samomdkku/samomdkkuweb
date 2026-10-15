// shop/sales.js — the ยอดขาย tab's counting rules.

import { describe, it, expect } from 'vitest';
import {
  salesReport, bkkDayKey, periodStartKey, makeBuckets, bucketUnit, niceTicks,
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
  it('weeks start on Monday and cover the range without gaps', () => {
    const b = makeBuckets('2026-10-01', '2026-10-15', 'week');   // 1 Oct 2026 is a Thursday
    expect(b[0].key).toBe('2026-09-28');
    for (let i = 1; i < b.length; i++) expect(b[i].key > b[i - 1].end).toBe(true);
    expect(b.at(-1).end >= '2026-10-15').toBe(true);
  });
  it('months roll over the year', () => {
    expect(makeBuckets('2026-12-15', '2027-01-02', 'month').map((x) => x.key)).toEqual(['2026-12-01', '2027-01-01']);
  });
});

describe('niceTicks', () => {
  it('rounds the top up to a clean number', () => {
    expect(niceTicks(1830)).toEqual([0, 1000, 2000]);
    expect(niceTicks(240)).toEqual([0, 125, 250]);
    expect(niceTicks(0)).toEqual([0, 1]);
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
