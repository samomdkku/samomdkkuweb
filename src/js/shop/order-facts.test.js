// shop/order-facts.js — attention counts, the slip queue's order, history.

import { describe, it, expect } from 'vitest';
import {
  attentionCounts, reviewQueue, slipSentAt, waitedLabel, isOverdue, orderHistory, actorLabel,
  STALE_PENDING_DAYS,
} from './order-facts.js';

const NOW = Date.parse('2026-10-15T05:00:00Z');
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

describe('attentionCounts', () => {
  const orders = [
    { id: 'a', status: 'review', placed_at: ago(30), slips: [{ at: ago(20) }, { at: ago(2) }], items: [] },
    { id: 'b', status: 'review', placed_at: ago(5), slip_uploaded_at: ago(4), items: [] },
    { id: 'c', status: 'slip_mismatch', placed_at: ago(50), items: [] },
    { id: 'd', status: 'pending', placed_at: ago(STALE_PENDING_DAYS * 24 + 1), items: [] },
    { id: 'e', status: 'pending', placed_at: ago(1), items: [] },
    { id: 'f', status: 'paid', placed_at: ago(9), items: [{ item_status: 'issue' }, { item_status: 'issue' }] },
    { id: 'g', status: 'paid', placed_at: ago(9), items: [{ item_status: 'done' }] },
    null,
  ];
  const c = attentionCounts(orders, NOW);

  it('counts each order once, by its order status', () => {
    expect(c).toMatchObject({ review: 2, mismatch: 1, pending: 2, pendingStale: 1, issueOrders: 1 });
  });
  it('the oldest wait in the queue is the slip sent longest ago (a re-sent slip counts from its newest)', () => {
    expect(c.oldestReviewAt).toBe(ago(4));
  });
  it('a pending order exactly at the line is not stale yet', () => {
    expect(attentionCounts([{ status: 'pending', placed_at: ago(STALE_PENDING_DAYS * 24) }], NOW).pendingStale).toBe(0);
  });
});

describe('reviewQueue — first sent, first checked', () => {
  it('orders by when the slip was sent, not when the order was placed', () => {
    const q = reviewQueue([
      { id: 'new-order-old-slip', status: 'review', placed_at: ago(1), slip_uploaded_at: ago(10) },
      { id: 'old-order-new-slip', status: 'review', placed_at: ago(40), slips: [{ at: ago(2) }] },
      { id: 'paid', status: 'paid', placed_at: ago(99) },
    ]);
    expect(q.map((o) => o.id)).toEqual(['new-order-old-slip', 'old-order-new-slip']);
  });
  it('slipSentAt takes the newest slip', () => {
    expect(slipSentAt({ slips: [{ at: ago(9) }, { at: ago(1) }, { url: 'x' }] })).toBe(ago(1));
    expect(slipSentAt({})).toBe('');
  });
});

describe('waitedLabel / isOverdue', () => {
  it('reads like a person', () => {
    expect(waitedLabel(ago(0), NOW)).toBe('เพิ่งส่ง');
    expect(waitedLabel(ago(0.5), NOW)).toBe('30 นาที');
    expect(waitedLabel(ago(5), NOW)).toBe('5 ชม.');
    expect(waitedLabel(ago(49), NOW)).toBe('2 วัน');
    expect(waitedLabel('', NOW)).toBe('เพิ่งส่ง');
  });
  it('a day unchecked is overdue', () => {
    expect(isOverdue(ago(25), NOW)).toBe(true);
    expect(isOverdue(ago(23), NOW)).toBe(false);
    expect(isOverdue('', NOW)).toBe(false);
  });
});

describe('orderHistory', () => {
  const products = [{ id: 'polo', name: 'Polo', colors: [{ id: 'g', label: 'เขียว' }] }];
  const order = {
    timeline: [
      { at: ago(10), stage: 'pending', label: 'รอชำระเงิน' },
      { at: ago(10), stage: 'review', label: 'ส่งสลิปแล้ว — รอตรวจ' },
      { at: ago(8), stage: 'paid', label: 'ยืนยันการชำระเงิน', by: 'admin' },
    ],
    items: [
      { product_id: 'polo', size: 'M', color: 'g', item_timeline: [{ at: ago(3), stage: 'produce', label: 'ผลิตเสร็จ', by: 'admin' }] },
      { product_id: 'gone', size: 'F', item_timeline: null },
    ],
  };
  const h = orderHistory(order, products);

  it('merges the order and its lines, oldest first, same-instant entries in written order', () => {
    expect(h.map((e) => e.stage)).toEqual(['pending', 'review', 'paid', 'produce']);
  });
  it('a line entry names its product and variant', () => {
    expect(h[3].what).toBe('Polo (ไซส์ M · เขียว)');
    expect(h[0].what).toBe('');
  });
  it('survives an order with no history at all', () => {
    expect(orderHistory({}, [])).toEqual([]);
  });
  it('actorLabel', () => {
    expect(actorLabel('admin')).toBe('แอดมิน');
    expect(actorLabel('')).toBe('');
    expect(actorLabel('someone')).toBe('someone');
  });
});

describe('instants compare as numbers, not strings', () => {
  it('a Postgres +00:00 stamp and a JS Z stamp order by time', () => {
    // As strings, "…T10:00:00.5Z" > "…T10:00:00.400000+00:00" happens to hold,
    // but "…T09:59:59+07:00" (03:00Z) sorts AFTER "…T05:00:00Z" as a string.
    const q = reviewQueue([
      { id: 'later', status: 'review', slip_uploaded_at: '2026-10-15T05:00:00Z' },
      { id: 'earlier', status: 'review', slip_uploaded_at: '2026-10-15T09:59:59+07:00' },
    ]);
    expect(q.map((o) => o.id)).toEqual(['earlier', 'later']);
    expect(slipSentAt({ slips: [{ at: '2026-10-15T09:59:59+07:00' }, { at: '2026-10-15T05:00:00Z' }] }))
      .toBe('2026-10-15T05:00:00Z');
  });
  it('an undated entry sorts first in history', () => {
    const h = orderHistory({ timeline: [{ at: '2026-10-15T05:00:00Z', stage: 'paid' }, { stage: 'pending' }] });
    expect(h.map((e) => e.stage)).toEqual(['pending', 'paid']);
  });
});

describe('the attention tiles count what their filter shows', () => {
  const lines = (src, status = 'paid') => [{ product_source: src, item_status: status }];
  const orders = [
    { id: 'm1', status: 'slip_mismatch', items: lines('md') },
    { id: 'm2', status: 'slip_mismatch', items: lines('mdi') },
    { id: 'i1', status: 'paid', items: lines('md', 'issue') },
    { id: 'i2', status: 'cancel', items: lines('md', 'issue') },       // cancelled: nothing left to do
    { id: 'i3', status: 'paid', items: [...lines('mdi', 'issue'), ...lines('md')] }, // issue is on the OTHER source's line
  ];
  it('a scope (แหล่งที่มา) narrows every count to orders with a line in it', () => {
    const md = attentionCounts(orders, NOW, { lineInScope: (it) => it.product_source === 'md' });
    expect(md.mismatch).toBe(1);
    expect(md.issueOrders).toBe(1);   // i1 only: i3's md line is fine, i2 is cancelled
  });
  it('unscoped, a cancelled order with a flagged line is not "needs attention"', () => {
    expect(attentionCounts(orders, NOW).issueOrders).toBe(2);
  });
  it('a review order with no slip time waits from when it was placed, as in the queue', () => {
    const c = attentionCounts([
      { id: 'x', status: 'review', placed_at: ago(200) },
      { id: 'y', status: 'review', placed_at: ago(1), slip_uploaded_at: ago(1) },
    ], NOW);
    expect(c.oldestReviewAt).toBe(ago(200));
    expect(reviewQueue([{ id: 'y', status: 'review', slip_uploaded_at: ago(1) }, { id: 'x', status: 'review', placed_at: ago(200) }])[0].id).toBe('x');
  });
  it('the production-status trigger\'s "cascade" reads as ระบบ', () => {
    expect(actorLabel('cascade')).toBe('ระบบ');
  });
});
