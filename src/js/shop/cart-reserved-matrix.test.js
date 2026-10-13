// THE BUG. The cart drawer's qty cap (the + button's disabled state, and the
// clamp inside list.onclick) read `p.reserved_matrix` off whatever
// setShopCartProducts() was last handed — which is listProducts()'s raw
// result. listProducts() never includes reserved counts (they're a separate
// RPC, shop_reserved_matrix_all); only checkout.js's own productsWithStock()
// spliced them on, for checkout's OWN use. The drawer's own `maxFor` always
// read an empty {} and treated every variant as fully available, even one
// whose stock was entirely reserved by other buyers' pending orders —
// letting a buyer raise a cart line's qty past what checkout (correctly)
// would then refuse. See cart.js's setCartReservedMatrix + maxQtyFor.
//
// This is the same class as reserved-rule.test.js (0202) — a number shown to
// the buyer disagreeing with what the server will actually allow — just one
// layer closer to the DOM (the drawer, not the storefront grid).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { maxQtyFor } from './cart.js';

const product = {
  id: 'p1',
  colors: [{ id: 'black' }],
  stock_matrix: { 'M-black': 5 },
  // Deliberately no reserved_matrix of its own — this is the shape
  // listProducts() actually returns.
};

const item = { productId: 'p1', size: 'M', color: 'black' };

describe('maxQtyFor — the cart drawer qty cap', () => {
  it('caps at 1 (the floor) when the variant is fully reserved, not 99', () => {
    // maxQtyFor floors at 1 (pre-existing behavior, unrelated to this fix —
    // the + button's own `qty >= max` check is what actually blocks a raise
    // once the line's own qty reaches it). The regression this guards is the
    // gap between this (1) and what the BUG returned here before the fix
    // (99, from an always-empty reserved matrix).
    const reservedMatrixById = { p1: { 'M-black': 5 } }; // all 5 taken
    expect(maxQtyFor(product, item, reservedMatrixById)).toBe(1);
  });

  it('caps at what is actually left when partially reserved', () => {
    const reservedMatrixById = { p1: { 'M-black': 3 } }; // 2 left
    expect(maxQtyFor(product, item, reservedMatrixById)).toBe(2);
  });

  it('reads 0 reserved (not the untracked-99 fallback) when the matrix has no entry for this product at all', () => {
    // Regression guard for the exact bug: calling with reservedMatrixById
    // missing this product's entry must read as 0 reserved — the untracked
    // (99) fallback is ONLY for a variant with no stock number configured,
    // never for "we don't know the reservations yet".
    expect(maxQtyFor(product, item, { otherProduct: { 'M-black': 99 } })).toBe(5);
    expect(maxQtyFor(product, item, {})).toBe(5);
  });

  it('returns 99 for a variant with no stock number configured at all (genuinely untracked)', () => {
    const untracked = { id: 'p2', colors: [{ id: 'black' }], stock_matrix: {} };
    expect(maxQtyFor(untracked, item, { p2: { 'M-black': 3 } })).toBe(99);
  });
});

// Structural check that the fix is actually WIRED, not just present and
// unused — both callers that learn the reserved matrix from the server must
// hand it to cart.js, or the drawer is back to never knowing about it.
describe('setCartReservedMatrix is actually called where the matrix is fetched', () => {
  it('index.js calls it after fetching the reserved matrix on shop-tab-open', () => {
    const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    expect(src).toMatch(/setCartReservedMatrix\(await fetchReservedMatrixAll\(\)\)/);
  });

  it('checkout.js calls it after refreshing stock, so the drawer stays in step with checkout', () => {
    const src = readFileSync(new URL('./checkout.js', import.meta.url), 'utf8');
    expect(src).toMatch(/setCartReservedMatrix\(reserved(All)?\)/);
  });
});

describe('a FAILED reserved fetch never lifts the cap (code review, 2026-10-13)', () => {
  it('keeps the last good matrix on failure, replaces it on a real answer', async () => {
    const { nextReservedMatrix } = await import('./cart.js');
    const { RESERVED_FETCH_FAILED } = await import('./api.js');
    const good = { p1: { M: 3 } };
    const failed = Object.defineProperty({}, RESERVED_FETCH_FAILED, { value: true });
    expect(nextReservedMatrix(good, failed)).toBe(good);
    expect(nextReservedMatrix(good, null)).toBe(good);
    const realEmpty = {};                                   // genuinely nothing reserved
    expect(nextReservedMatrix(good, realEmpty)).toBe(realEmpty);
  });
});
