// ============================================================
// cart-maxhint.test.js — the cart drawer's "+" button, once the stepper is
// at the stock cap, must carry a VISIBLE reason, not a title="" tooltip.
//
// THE BUG (task 17's phone friction sweep). The + button's disabled state
// used to explain itself only through `title="ครบจำนวนที่เหลือแล้ว"` — a
// hover tooltip, which does not exist on a phone (no cursor to hover with).
// A buyer on their phone saw a faded + with zero explanation for why they
// could not add more. Same failure shape as mistakes.md class 4's "a title
// tooltip does not exist on a phone", applied to a disabled-control reason
// instead of truncated text.
//
// Fixed by rendering the reason as a permanent line under the row
// (`.cart-item-maxhint`) instead of a title attribute, so it reaches every
// device, not just the ones that can hover.
//
// No jsdom in this repo's test setup, so this pins the fix structurally —
// the same technique as main-quill-image.test.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';

const SRC = stripComments(readFileSync(new URL('./cart.js', import.meta.url), 'utf8'));
const CSS = readFileSync(new URL('../../css/shop.css', import.meta.url), 'utf8');

describe('shop cart — the "+" button\'s max-reached reason is visible, not hover-only', () => {
  it('no longer uses a title="" attribute for the max-reached reason', () => {
    expect(SRC).not.toMatch(/title="ครบจำนวนที่เหลือแล้ว"/);
  });

  it('renders a permanent hint line instead', () => {
    expect(SRC).toMatch(/cart-item-maxhint/);
    expect(SRC).toMatch(/ครบจำนวนที่เหลือแล้ว/);
  });

  it('the hint only appears when the line is actually at its cap (it.qty >= max)', () => {
    const idx = SRC.indexOf('cart-item-maxhint');
    const before = SRC.slice(Math.max(0, idx - 200), idx);
    expect(before).toMatch(/it\.qty\s*>=\s*max/);
  });

  it('the + button keeps its disabled state at the cap', () => {
    const btnIdx = SRC.indexOf('data-cart-qty="+1"');
    const btnLine = SRC.slice(btnIdx, btnIdx + 150);
    expect(btnLine).toMatch(/it\.qty\s*>=\s*max\s*\?\s*'disabled'/);
  });

  it('the stylesheet defines .cart-item-maxhint', () => {
    expect(CSS).toMatch(/\.cart-item-maxhint\s*\{/);
  });
});
