// THE BUG (HANDOFF §18f — "CONFIRMED popup"). With no colour picked, the qty
// '+' button in the product popup went to 99 (availableForVariant has no
// colour to look up, so it reads as "untracked"); picking a low-stock colour
// only called renderOOS(), never renderQty(), so a qty already raised to 99
// survived picking a colour with e.g. 3 left — the add button then adds 99 of
// a 3-left variant. Checkout's own stock check (shop.md.mistakes.md class 2)
// would eventually refuse it, but by then the buyer has already "added" a
// number the UI never let them see was wrong.
//
// qtyCeilingFor/isColorMissing are PURE (no DOM), extracted the same way
// cart.js's maxQtyFor was for the identical reason (cart-reserved-matrix.test.js):
// the render path that calls them needs jsdom, which this repo's test setup
// does not have.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { qtyCeilingFor, isColorMissing } from './products.js';

const multiColor = {
  colors: [{ id: 'black' }, { id: 'red' }],
  stock_matrix: { 'F-black': 10, 'F-red': 3 },
};
const oneColor = { colors: [{ id: 'black' }], stock_matrix: { 'F-black': 10 } };
const untracked = { colors: [{ id: 'black' }, { id: 'red' }] };   // no stock_matrix at all
const preorderUnlimited = { is_presale: true, colors: [{ id: 'black' }, { id: 'red' }] };   // empty grid

describe('isColorMissing', () => {
  it('true only when there IS a choice and none was made', () => {
    expect(isColorMissing(multiColor, null)).toBe(true);
    expect(isColorMissing(multiColor, 'red')).toBe(false);
    expect(isColorMissing(oneColor, null)).toBe(false);   // nothing to choose
    expect(isColorMissing(null, null)).toBe(false);
  });
});

describe('qtyCeilingFor — the popup qty cap', () => {
  it('caps at 1 while a colour choice is still outstanding — THE BUG', () => {
    // Before picking a colour, the real per-variant stock (3, for red) is
    // unknown; the old code let this read as 99.
    expect(qtyCeilingFor(multiColor, 'F', null)).toBe(1);
  });
  it('uses the matrix once a colour is known', () => {
    expect(qtyCeilingFor(multiColor, 'F', 'red')).toBe(3);
    expect(qtyCeilingFor(multiColor, 'F', 'black')).toBe(10);
  });
  it('a single colour needs no pick, so the matrix applies immediately', () => {
    // openProductModal always pre-fills modalState.color with the one colour
    // a product has — this is the id it would be called with, never null.
    expect(qtyCeilingFor(oneColor, 'F', 'black')).toBe(10);
  });
  it('an untracked product still caps at 1 while the colour pick is outstanding', () => {
    expect(qtyCeilingFor(untracked, 'F', null)).toBe(1);
  });
  it('an untracked product is 99 once a colour IS chosen (no matrix to read)', () => {
    expect(qtyCeilingFor(untracked, 'F', 'red')).toBe(99);
  });
  it('an unlimited preorder (empty grid) is 99 even with colours to pick', () => {
    expect(qtyCeilingFor(preorderUnlimited, 'F', null)).toBe(99);
  });
  it('no product at all is 99 (nothing to cap against)', () => {
    expect(qtyCeilingFor(null, 'F', null)).toBe(99);
  });
});

// The handler shape: picking a colour must re-run renderQty(), not only
// renderOOS() — the part of the original bug that qtyCeilingFor alone
// doesn't prove, since calling it is a DOM wiring choice, not a pure value.
// Same structural-pinning technique as admin-order-modal.test.js (no jsdom).
const SRC = readFileSync(new URL('./products.js', import.meta.url), 'utf8');
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
function functionBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return src.slice(start, i - 1);
}

describe('renderColorOptions wires up the colour-click handler', () => {
  it('calls renderQty() — not only renderOOS() — so a stale qty re-clamps', () => {
    expect(functionBody(CODE, 'renderColorOptions')).toMatch(/renderQty\(\)/);
  });
});
