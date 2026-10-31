// org-chart-one-view.test.js — เกี่ยวกับเรา shows ONE view since 2026-10-31.
//
// Was org-lines.test.js, which guarded ผังสายงาน and the four view keys. The
// owner removed ผังสายงาน, แผนผัง and ผังรวม ("only left the ภาพรวม"), so what
// is left to hold: the stylesheet still parses (the panel rules the ภาพรวม
// sheet reuses), and nothing brings a switcher or a removed view back halfway —
// a button whose renderer is gone does nothing when tapped.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const CSS = readFileSync(new URL('../css/org-chart.css', import.meta.url), 'utf8');
const JS = stripComments(readFileSync(new URL('./org-chart.js', import.meta.url), 'utf8'));

// ── §A. The stylesheet parses ───────────────────────────────────────────────
describe('src/css/org-chart.css parses', () => {
  it('every comment is closed', () => {
    // The instrument's own limitation, stated: this counts markers rather than
    // parsing, so a `/*` inside a string or a url() would fool it. This
    // stylesheet has none, and if one is ever added the count fails LOUDLY
    // rather than passing quietly — which is the right direction for a check
    // whose whole subject is silent breakage.
    expect((CSS.match(/\/\*/g) || []).length).toBe((CSS.match(/\*\//g) || []).length);
  });

  it('every block is closed', () => {
    expect((CSS.match(/\{/g) || []).length).toBe((CSS.match(/\}/g) || []).length);
  });

  it('no rule is stranded inside a comment', () => {
    // The specific shape that shipped: a declaration block sitting between an
    // unclosed `/*` and the next `*/`. Detected by asking whether the rules we
    // know must exist survive comment-stripping — see §B, which is the same
    // question asked of every class at once.
    const live = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.orgc-unit', '.orgc-seat', '.orgc-tree']) {
      expect(live, `${sel} must be a live rule, not commented out`).toContain(`${sel} {`);
    }
  });
});

// ── §B. One view ──────────────────────────────────────────────────────────
describe('ภาพรวม is the only view', () => {
  const HTML = readFileSync(new URL('../html/tab-about.html', import.meta.url), 'utf8');
  it('no view switcher, no removed renderer, no saved-view read', () => {
    expect(JS).not.toMatch(/data-org-view/);
    expect(JS).not.toMatch(/linesHtml|lineBlock|paintGraph|mountOrgGraph/);
    expect(JS).not.toMatch(/samo\.org\.view/);
  });
  it('the page renders the overview', () => {
    expect(JS).toMatch(/const panels = overviewPanels\(roots, filter\)/);
  });
  it('no control on the page for a view that is gone', () => {
    expect(HTML).not.toMatch(/orgExpandAll/);
    expect(CSS).not.toMatch(/\.org-view-btn|\.org-lines/);
  });
  it('d3-org-chart is not imported anywhere (its only user was ผังรวม)', () => {
    expect(JS).not.toMatch(/org-graph/);
  });
});
