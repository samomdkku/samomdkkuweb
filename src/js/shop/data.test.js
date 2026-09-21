// Pure-function tests for shop/data.js.

import { describe, it, expect } from 'vitest';
import {
  sanitizeOrderCode, genOrderId, STAGES_META, ISSUE_STATUSES,
  rollupOrderStage, itemStageRank,
} from './data.js';

describe('sanitizeOrderCode', () => {
  it('uppercases + strips non-alnum + caps at 5', () => {
    expect(sanitizeOrderCode('sh')).toBe('SH');
    expect(sanitizeOrderCode('Sh-01!')).toBe('SH01');
    expect(sanitizeOrderCode('Polo123456')).toBe('POLO1');
    expect(sanitizeOrderCode('   ')).toBe('SH');
    expect(sanitizeOrderCode('!@#$')).toBe('SH');
  });

  it('falls back to "SH" for null / undefined / empty', () => {
    expect(sanitizeOrderCode(null)).toBe('SH');
    expect(sanitizeOrderCode(undefined)).toBe('SH');
    expect(sanitizeOrderCode('')).toBe('SH');
  });
});

describe('genOrderId', () => {
  it('uses the supplied code as prefix', () => {
    for (let i = 0; i < 50; i++) {
      const id = genOrderId('TS');
      expect(id.startsWith('TS')).toBe(true);
      expect(id).toMatch(/^TS\d{4}$/);
    }
  });

  it('falls back to "SH" when no code is supplied', () => {
    expect(genOrderId()).toMatch(/^SH\d{4}$/);
    expect(genOrderId('')).toMatch(/^SH\d{4}$/);
    expect(genOrderId(null)).toMatch(/^SH\d{4}$/);
  });

  it('emits a 4-digit suffix (no leading 0; range 1000..9999)', () => {
    for (let i = 0; i < 50; i++) {
      const id = genOrderId('SH');
      const n = Number(id.slice(2));
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });

  it('sanitises bad codes the same way sanitizeOrderCode does', () => {
    expect(genOrderId('sh!@#')).toMatch(/^SH\d{4}$/);
    expect(genOrderId('Polo123456')).toMatch(/^POLO1\d{4}$/);
  });
});

describe('rollupOrderStage (Hybrid per-item model)', () => {
  it('returns the order status verbatim for pre-paid / off-path / legacy', () => {
    expect(rollupOrderStage({ status: 'pending', items: [] })).toBe('pending');
    expect(rollupOrderStage({ status: 'review', items: [] })).toBe('review');
    expect(rollupOrderStage({ status: 'cancel', items: [] })).toBe('cancel');
    expect(rollupOrderStage({ status: 'slip_mismatch', items: [] })).toBe('slip_mismatch');
    // legacy whole-order advanced before the migration → trusted as-is
    expect(rollupOrderStage({ status: 'ready', items: [{ item_status: 'paid' }] })).toBe('ready');
  });

  it('for a paid order, rolls up to the least-progressed item', () => {
    expect(rollupOrderStage({ status: 'paid', items: [
      { item_status: 'ready' }, { item_status: 'produce' }, { item_status: 'done' },
    ] })).toBe('produce');
    expect(rollupOrderStage({ status: 'paid', items: [
      { item_status: 'ready' }, { item_status: 'ready' },
    ] })).toBe('ready');
    expect(rollupOrderStage({ status: 'paid', items: [
      { item_status: 'done' }, { item_status: 'done' },
    ] })).toBe('done');
  });

  it('an item issue (มีปัญหา) holds the order back to "paid"', () => {
    expect(rollupOrderStage({ status: 'paid', items: [
      { item_status: 'ready' }, { item_status: 'issue' },
    ] })).toBe('paid');
  });

  it('paid order with no items falls back to paid; itemStageRank orders stages', () => {
    expect(rollupOrderStage({ status: 'paid', items: [] })).toBe('paid');
    expect(itemStageRank('paid')).toBeLessThan(itemStageRank('produce'));
    expect(itemStageRank('produce')).toBeLessThan(itemStageRank('ready'));
    expect(itemStageRank('ready')).toBeLessThan(itemStageRank('done'));
    expect(itemStageRank('issue')).toBe(0);
  });
});

describe('STAGES_META + ISSUE_STATUSES', () => {
  it('every entry tagged issue:true is listed in ISSUE_STATUSES (single source of truth)', () => {
    const tagged = Object.entries(STAGES_META)
      .filter(([, m]) => m.issue)
      .map(([k]) => k);
    expect(ISSUE_STATUSES).toEqual(tagged);
  });

  it('every issue status carries a tone for chip colouring', () => {
    for (const s of ISSUE_STATUSES) {
      expect(STAGES_META[s].tone).toBeTruthy();
      expect(['warning', 'info', 'neutral', 'danger']).toContain(STAGES_META[s].tone);
    }
  });
});

// 0199 — the per-size price rule. The SAME table is replayed against the SQL
// function by tools/shop0199-pricing.sql, so JS (what the page shows) and SQL
// (what the order charges) cannot drift without one of them going red.
import priceCases from './price-cases.json';
import { unitPriceFor, priceRange } from './data.js';

describe('unitPriceFor mirrors public.shop_unit_price', () => {
  for (const c of priceCases.cases) {
    it(c.name, () => expect(unitPriceFor(c.product, c.size)).toBe(c.expect));
  }
  it('priceRange spans the sizes', () => {
    const p = { price: 250, sizes: ['S', 'M', 'XL'], price_by_size: { XL: 290, S: 240 } };
    expect(priceRange(p)).toEqual({ min: 240, max: 290 });
    expect(priceRange({ price: 100 })).toEqual({ min: 100, max: 100 });
  });
});
