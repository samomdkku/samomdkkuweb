// ==============================================
// The ผังตามสาย legend must not become a SECOND hand-typed copy of
// SAI_CELL_STYLE (index.js) — that is the exact class-6 shape this same
// feature already paid for twice tonight (splitHeld, groupBySaiNumber in
// gaps.js; see docs/mistakes/app-state.md). Before this fix, the five legend
// badges in tab-house.html were typed by hand, once, the same night
// SAI_CELL_STYLE was written — they agreed only because nobody had touched
// either side since. There is no jsdom in this repo (checked: no
// vitest-environment anywhere), so this pins the SOURCE the way
// my-house.test.js's `wireClaim` block already does for the same reason —
// a review of the shape, not a run of the render, per
// `.claude/rules/mistakes.md` class 7 ("a source guard is a review, not a
// test" — it is blind to a typo'd class name, but it is not blind to the
// one thing that actually drifted here before: a SECOND definition existing
// at all).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const JS = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../../html/tab-house.html', import.meta.url), 'utf8');

describe('renderSaiGridLegend', () => {
  it('is generated in index.js from SAI_CELL_STYLE, not hand-typed', () => {
    const fn = JS.slice(JS.indexOf('function renderSaiGridLegend'), JS.indexOf('function renderSaiGridPane'));
    expect(fn).toMatch(/SAI_CELL_STYLE\[state\]/);
    expect(fn).toMatch(/SAI_LEGEND_ORDER\.map/);
  });

  it('covers every state SAI_CELL_STYLE defines, once each', () => {
    // SAI_LEGEND_ORDER is a literal array in the same file — read it back
    // rather than trusting the count, so a state added to SAI_CELL_STYLE and
    // forgotten in the legend order shows up as a length mismatch.
    const styleBlock = JS.slice(JS.indexOf('const SAI_CELL_STYLE'), JS.indexOf('const SAI_LEGEND_ORDER'));
    const stateCount = [...styleBlock.matchAll(/\[SAI_CELL\.\w+\]:/g)].length;
    const orderMatch = JS.match(/const SAI_LEGEND_ORDER = \[([^\]]+)\]/);
    expect(orderMatch).not.toBeNull();
    const orderCount = orderMatch[1].split(',').filter((s) => s.trim()).length;
    expect(orderCount).toBe(stateCount);
  });

  it('tab-house.html no longer hand-types the five state badges', () => {
    // The pre-fix markup had all five Thai labels sitting in the HTML
    // literally, beside their own bg-*-subtle classes. If a future edit
    // reverts to that shape, at least one of these will reappear next to its
    // own badge markup — check the specific pairing, not just the bare label
    // text, since "ปกติ" alone can legitimately appear elsewhere on the page.
    expect(HTML).not.toMatch(/bg-success-subtle[^]*?ปกติ<\/span>/);
    expect(HTML).not.toMatch(/bg-danger-subtle[^]*?ต้องมีคนช่วยยืนยัน/);
  });

  it('tab-house.html provides the empty mount point the JS fills', () => {
    expect(HTML).toMatch(/id="houseSaiGridLegend"/);
  });

  it('renderSaiGridPane calls renderSaiGridLegend on every paint', () => {
    const fn = JS.slice(JS.indexOf('function renderSaiGridPane'), JS.indexOf('function renderSaiGridPane') + 400);
    expect(fn).toMatch(/renderSaiGridLegend\(\)/);
  });
});
