// ==============================================
// shop/state.test.js — the cart's cross-tab storage sync (night-agent task 9,
// 2026-10-18: walking the customer checkout flow for the owner's "navigates
// away — another tab — comes back" worry).
//
// Each browser tab gets its OWN module instance with its OWN in-memory
// `cart` variable, loaded once from localStorage at import time. Before the
// fix, a second tab's mutation always persisted ITS stale copy, silently
// dropping anything the first tab had added that the second tab's copy
// never saw. Simulated here with two separately-reset module instances
// sharing one fake localStorage — the real browser fires the `storage`
// event automatically in every OTHER tab; this test calls the second tab's
// registered listener directly, since there is no real DOM to dispatch it.
// ==============================================
import { describe, it, expect, vi, afterEach } from 'vitest';

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

afterEach(() => {
  delete global.window;
  delete global.localStorage;
  vi.resetModules();
});

describe('cart cross-tab sync', () => {
  it('a storage event from another tab refreshes this tab\'s in-memory cart before its next write, so neither tab\'s add is lost', async () => {
    const sharedLocalStorage = makeLocalStorage();
    const listeners = []; // one per simulated "tab", in import order

    global.localStorage = sharedLocalStorage;
    global.window = {
      addEventListener: (type, cb) => { if (type === 'storage') listeners.push(cb); },
    };

    vi.resetModules();
    const tabA = await import('./state.js');
    vi.resetModules();
    const tabB = await import('./state.js');

    expect(listeners).toHaveLength(2);
    expect(tabA.getCart()).toEqual([]);
    expect(tabB.getCart()).toEqual([]);

    tabA.addItem({ productId: 'X', size: 'F', color: 'default', fit: null, qty: 1, price: 10 });
    expect(JSON.parse(sharedLocalStorage.getItem('samoshop.cart.v1'))).toHaveLength(1);

    // Tab B is still unaware — this is the window where the bug used to bite.
    expect(tabB.getCart()).toEqual([]);

    // The real browser delivers this to tab B automatically; fire it by hand.
    listeners[1]({ key: 'samoshop.cart.v1' });
    expect(tabB.getCart().map((i) => i.productId)).toEqual(['X']);

    tabB.addItem({ productId: 'Y', size: 'F', color: 'default', fit: null, qty: 1, price: 20 });
    const final = JSON.parse(sharedLocalStorage.getItem('samoshop.cart.v1'));
    expect(final.map((i) => i.productId).sort()).toEqual(['X', 'Y']);
  });

  it('a storage event for an unrelated key is ignored (never reloads the cart from garbage)', async () => {
    const sharedLocalStorage = makeLocalStorage();
    const listeners = [];
    global.localStorage = sharedLocalStorage;
    global.window = { addEventListener: (type, cb) => { if (type === 'storage') listeners.push(cb); } };

    vi.resetModules();
    const tab = await import('./state.js');
    tab.addItem({ productId: 'X', size: 'F', color: 'default', fit: null, qty: 1, price: 10 });
    listeners[0]({ key: 'some.other.key' });
    expect(tab.getCart().map((i) => i.productId)).toEqual(['X']);
  });

  it('a storage event with key:null (localStorage.clear()) reloads too, so a clear elsewhere is not undone by this tab\'s next write', async () => {
    const sharedLocalStorage = makeLocalStorage();
    const listeners = [];
    global.localStorage = sharedLocalStorage;
    global.window = { addEventListener: (type, cb) => { if (type === 'storage') listeners.push(cb); } };

    vi.resetModules();
    const tab = await import('./state.js');
    tab.addItem({ productId: 'X', size: 'F', color: 'default', fit: null, qty: 1, price: 10 });
    expect(tab.getCart()).toHaveLength(1);

    // Simulate another tab calling localStorage.clear() for real.
    sharedLocalStorage.removeItem('samoshop.cart.v1');
    listeners[0]({ key: null });
    expect(tab.getCart()).toEqual([]);
  });
});

// THE BUG (HANDOFF §18f — "CONFIRMED cart"). addItem merging an existing
// line only capped the TOTAL at the hardcoded 99, never at what the caller
// knows is actually available for that variant — so adding a low-stock item
// already in the cart again pushed the line past real stock, something the
// drawer's own +/- (cart.js's maxQtyFor) was careful to prevent for the SAME
// line. The product popup now passes qtyCeilingFor(...) as this cap
// (products.js); checkout.js rebuilding a failed order's cart passes none,
// keeping the old 99 ceiling since that is restoring pre-existing qty, not
// adding past a stock limit.
describe('addItem respects a per-call stock cap', () => {
  const ITEM = { productId: 'X', size: 'F', color: 'red', fit: 'unisex', qty: 2, price: 10 };
  it('merging past the cap clamps to it, not to 99', async () => {
    global.localStorage = makeLocalStorage();
    vi.resetModules();
    const tab = await import('./state.js');
    tab.addItem(ITEM, 5);   // 2 of 5
    tab.addItem(ITEM, 5);   // 4 of 5
    tab.addItem(ITEM, 5);   // would be 6 — must clamp to 5
    expect(tab.getCart()[0].qty).toBe(5);
  });
  it('a first add whose OWN qty exceeds the cap is clamped too', async () => {
    global.localStorage = makeLocalStorage();
    vi.resetModules();
    const tab = await import('./state.js');
    tab.addItem({ ...ITEM, qty: 10 }, 3);
    expect(tab.getCart()[0].qty).toBe(3);
  });
  it('no cap given keeps the old 99 ceiling', async () => {
    global.localStorage = makeLocalStorage();
    vi.resetModules();
    const tab = await import('./state.js');
    tab.addItem({ ...ITEM, qty: 150 });
    expect(tab.getCart()[0].qty).toBe(99);
  });
});
