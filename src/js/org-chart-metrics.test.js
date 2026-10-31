// ==============================================
// THE แผนผัง PORTRAIT SIZE IS ONE DECISION WRITTEN IN TWO FILES.
//
// `TREE_SHAPE` in org-face.js tells lh3 which widths to render and hands the
// browser a `sizes` hint; `.orgc-person > .org-face` in org-chart.css sets the
// box the browser will actually draw into. The browser resolves `srcset` from
// `sizes`, NOT from the box — so if the two disagree nothing throws:
//
//   sizes TOO SMALL  → a soft, upscaled portrait on any retina screen, which
//                      reads as "the photo is bad" rather than as a bug.
//   sizes TOO LARGE  → the right picture, at several times the bytes, 448 times
//                      over. This is what it WAS: the widths were [130, 200,
//                      260, 390] from the old portrait-above-name column, and
//                      the box is now 52px.
//
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: change `width: 3.25rem` to `4rem` in
// org-chart.css, or drop 104 from TREE_SHAPE's widths, and watch one assertion
// below fail. Then put it back.
//
// WHY IT PARSES THE SOURCE rather than importing: org-face.js pulls in
// uploads.js and the whole Drive URL layer. Reading the two files as text keeps
// the guard to the one question it is asking. Comments are stripped with the
// SHARED scanner — a hand-rolled block-comment regex is what blinded four other
// guards in this repo when it met `'image/*'`.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const face = stripComments(readFileSync(new URL('./org-face.js', import.meta.url), 'utf8'));
const css = stripComments(readFileSync(new URL('../css/org-chart.css', import.meta.url), 'utf8'));

/** The `.orgc-person > .org-face` box, in CSS px. */
function boxPx() {
  const block = css.match(/\.orgc-person\s*>\s*\.org-face\s*\{([^}]*)\}/);
  expect(block, 'org-chart.css must size the แผนผัง portrait on '
    + '`.orgc-person > .org-face`').toBeTruthy();
  const w = block[1].match(/width:\s*([0-9.]+)rem/);
  expect(w, 'that rule must set a rem width').toBeTruthy();
  return Number(w[1]) * 16;   // the app never changes the root font-size
}

/** TREE_SHAPE's `{ widths, sizes, base }`. */
function treeShape() {
  const block = face.match(/export const TREE_SHAPE = \{([\s\S]*?)\};/);
  expect(block, 'org-face.js must export TREE_SHAPE').toBeTruthy();
  const widths = block[1].match(/widths:\s*\[([^\]]*)\]/);
  const sizes = block[1].match(/sizes:\s*'([^']*)'/);
  const base = block[1].match(/base:\s*([0-9]+)/);
  expect(widths && sizes && base, 'TREE_SHAPE must carry widths, sizes and base').toBeTruthy();
  return {
    widths: widths[1].split(',').map((n) => Number(n.trim())),
    sizes: sizes[1],
    base: Number(base[1]),
  };
}

describe('แผนผัง portraits: org-face.js and org-chart.css agree on the box', () => {
  it('the `sizes` hint IS the CSS box — this view has no zoom to buy headroom for', () => {
    // Unlike ผังรวม, nothing here magnifies a card, so `sizes` is exactly the
    // drawn width and the DPR candidates do the rest.
    const { sizes } = treeShape();
    expect(sizes).toBe(`${boxPx()}px`);
  });

  it('the widths cover 1x, 2x and 3x of that box, and nothing wider', () => {
    const box = boxPx();
    const { widths } = treeShape();
    expect(widths).toEqual([box, box * 2, box * 3]);
  });

  it('`base` — the plain `src`, used when srcset is unavailable — is the 2x candidate', () => {
    // 2x rather than 1x: `src` is what a browser with no srcset support (and
    // every crawler) gets, and a 1x file on a retina phone is visibly soft.
    const { widths, base } = treeShape();
    expect(base).toBe(widths[1]);
  });

  it('the ratio the CSS crops to is the one lh3 is asked for', () => {
    // 3:4 in both places. lh3 crops server-side to TREE_SHAPE's ratio; if the
    // box disagrees the image letterboxes or squashes, silently.
    const block = css.match(/\n\.org-face\s*\{([^}]*)\}/);
    expect(block, 'org-chart.css must declare the .org-face box').toBeTruthy();
    expect(block[1].replace(/\s+/g, '')).toContain('aspect-ratio:3/4');
    expect(face).toMatch(/ratio:\s*PORTRAIT_RATIO/);
  });
});
