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

import { bannerLinkTarget } from './data.js';
describe('bannerLinkTarget', () => {
  it('follows http(s) in a new tab and a same-site path here', () => {
    expect(bannerLinkTarget('https://instagram.com/x')).toEqual({ href: 'https://instagram.com/x', external: true });
    expect(bannerLinkTarget('/shop#p-1')).toEqual({ href: '/shop#p-1', external: false });
    expect(bannerLinkTarget('#new')).toEqual({ href: '#new', external: false });
  });
  it('refuses every other scheme — an admin types it, every visitor follows it', () => {
    for (const h of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', '//evil.example', 'vbscript:x', '', null]) {
      expect(bannerLinkTarget(h), String(h)).toBeNull();
    }
  });
});

import { cartLineProblems } from './data.js';
describe('cartLineProblems — the server\'s refusals, asked before the buyer pays', () => {
  const tee = { id: 't', is_active: true, stock_status: 'available', sizes: ['S', 'M'],
    colors: [{ id: 'black' }], stock_matrix: { 'M-black': 3 }, reserved_matrix: { 'M-black': 1 } };
  const line = (o) => ({ productId: 't', size: 'M', color: 'black', qty: 1, ...o });
  it('passes a line that can be sold', () => {
    expect(cartLineProblems([line()], { t: tee }).size).toBe(0);
  });
  it('names each refusal', () => {
    const p = cartLineProblems([
      line({ productId: 'gone' }), line({ size: 'XL' }), line({ color: 'red' }), line({ color: undefined }),
    ], { t: tee });
    expect([...p.values()]).toEqual(['สินค้านี้ปิดขายแล้ว', 'ไม่มีไซส์นี้แล้ว', 'ไม่มีสีนี้แล้ว', 'ไม่มีสีนี้แล้ว']);
  });
  it('counts stock per variant ACROSS lines (2 left: 1 + 2 is too many)', () => {
    const p = cartLineProblems([line({ qty: 1, fit: 'a' }), line({ qty: 2, fit: 'b' })], { t: tee });
    expect(p.get(1)).toBe('เหลือเพียง 2 ชิ้น');
  });
  it('treats sold_out / hidden as closed, and preorder as unlimited', () => {
    expect(cartLineProblems([line()], { t: { ...tee, stock_status: 'sold_out' } }).get(0)).toBe('สินค้านี้ปิดขายแล้ว');
    expect(cartLineProblems([line()], { t: { ...tee, is_active: false } }).get(0)).toBe('สินค้านี้ปิดขายแล้ว');
    expect(cartLineProblems([line({ qty: 50 })], { t: { ...tee, is_presale: true } }).size).toBe(0);
  });
  it('a colourless product takes no colour', () => {
    const plain = { ...tee, colors: [], stock_matrix: {} };
    expect(cartLineProblems([line({ color: null })], { t: plain }).size).toBe(0);
    expect(cartLineProblems([line({ color: 'black' })], { t: plain }).get(0)).toBe('ไม่มีสีนี้แล้ว');
  });
});

import { csvCell, csvPhoneCell, bkkTime } from './data.js';
describe('CSV export cells', () => {
  it('neutralises a cell a spreadsheet would run as a formula', () => {
    for (const bad of ['=HYPERLINK("http://x","a")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(csvCell(bad).startsWith(`"'`), bad).toBe(true);
    }
    expect(csvCell('น้องเอ, "ไซส์ M"')).toBe('"น้องเอ, ""ไซส์ M"""');
    expect(csvCell(-5)).toBe('-5'); // a real number is still a number
  });
  it('keeps a phone number as text with its leading zero, and nothing else', () => {
    expect(csvPhoneCell('081-234-5678')).toEqual({ text: '"=""081-234-5678"""' });
    expect(csvPhoneCell('08")&CMD|x')).toEqual({ text: '"=""08"""' });
    expect(csvCell(csvPhoneCell('0812345678'))).toBe('"=""0812345678"""');
  });
  it('writes Bangkok time, not UTC', () => {
    expect(bkkTime('2026-09-21T18:30:00Z')).toBe('2026-09-22 01:30:00');
    expect(bkkTime('')).toBe('');
  });
});

import { imageBase, pictureAt, productImages, imageIndexForColor, pictureFor, imageAlt } from './data.js';
describe('product pictures', () => {
  const L = (id, s = '') => `https://lh3.googleusercontent.com/d/${id}${s}`;
  const tee = {
    name: 'เสื้อ', colors: [{ id: 'black', label: 'ดำ' }, { id: 'red', label: 'แดง' }],
    images: [{ url: L('A'), w: 10, h: 20, color: null }, { url: L('B'), color: 'black' }, { url: L('C'), color: 'gone' }],
    image_url: L('A', '=w1200'),
  };
  it('sizes one stored lh3 URL, and leaves other URLs alone', () => {
    expect(imageBase(L('A', '=w1200'))).toBe(L('A'));
    expect(pictureAt(L('A', '=w1200'), 200)).toBe(L('A', '=w200'));
    expect(pictureAt('https://drive.google.com/file/d/X/view', 200)).toBe('https://drive.google.com/file/d/X/view');
    expect(pictureAt('', 200)).toBe('');
  });
  it('reads images, falling back to the legacy cover', () => {
    expect(productImages(tee).map((x) => x.url)).toEqual([L('A'), L('B'), L('C')]);
    expect(productImages({ image_url: L('Z', '=w1200') })).toEqual([{ url: L('Z'), w: null, h: null, color: null }]);
    expect(productImages({})).toEqual([]);
  });
  it('finds a colour\'s first picture; a deleted colour\'s tag counts as none', () => {
    expect(imageIndexForColor(tee, 'black')).toBe(1);
    expect(imageIndexForColor(tee, 'red')).toBe(-1);
    expect(imageIndexForColor(tee, 'gone')).toBe(-1);
    expect(pictureFor(tee, 'black')).toBe(L('B'));
    expect(pictureFor(tee, 'red')).toBe(L('A'));    // no tagged picture → cover
    expect(pictureFor({}, 'red')).toBe('');
  });
  it('generates alt text', () => {
    expect(imageAlt(tee, tee.images[1], 1, 3)).toBe('เสื้อ สีดำ (รูปที่ 2 จาก 3)');
    expect(imageAlt(tee, tee.images[0], 0, 1)).toBe('เสื้อ');
  });
});
