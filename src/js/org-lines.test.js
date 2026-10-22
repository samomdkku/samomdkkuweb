// ============================================================
// org-lines.test.js — ผังสายงาน, the connector chart restored beside แผนผัง
// (2026-08-25).
//
// WHY THIS FILE EXISTS, and it is not "the new view should work"
//
// Restoring it meant lifting ~230 lines of CSS out of a deleted commit and
// re-hooking them onto markup whose neighbours had been renamed. The first
// attempt sliced that CSS BY LINE NUMBER, cut a comment in half, and shipped
// an unclosed `/*` — which silently swallowed the next three rules, including
// the one that draws the ฝ่าย dot and the one that lays out the station row.
// The page still rendered. It rendered WRONG, in a way that looks exactly like
// a design choice: names centred instead of left, no dot, no visible error
// anywhere. It was caught by looking at a screenshot, which is not a mechanism.
//
// So the assertions here are about the two properties that failure violated:
//
//   §A  the stylesheet PARSES — comments and braces balance. An unclosed
//       comment is the only CSS defect that can delete code you never touched.
//   §B  every class the renderer EMITS is STYLED. This is the real one: a rule
//       that got commented out, a selector left pointing at an old class name,
//       and a class nobody ever wrote a rule for are three different mistakes
//       with one symptom, and CSS reports none of them.
//
// §C guards the key mapping, which is the other thing a restore can silently
// break — the restored view historically owned `'chart'`, and `'chart'` now
// means the panel view.
//
// The ORDERING differential lives in org-rung.test.js, extended rather than
// duplicated: three views ordering one ฝ่าย is ONE claim.
// ============================================================
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
    for (const sel of ['.org-station-btn', '.org-station-dot', '.org-station-name']) {
      expect(live, `${sel} must be a live rule, not commented out`).toContain(`${sel} {`);
    }
  });
});

// ── §B. Every class the renderer emits has a rule ───────────────────────────
describe('ผังสายงาน: every class it renders is styled', () => {
  /** The classes `lineBlock()` and `linesHtml()` write into the DOM, read out
   *  of the comment-stripped source rather than listed by hand. A list written
   *  from the same source the code came from proves the list matches itself;
   *  this at least fails when the renderer stops emitting one. */
  const emitted = (() => {
    const from = JS.indexOf('function lineBlock(');
    const to = JS.indexOf('function renderExpandAll(');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const src = JS.slice(from, to);
    const out = new Set();
    for (const m of src.matchAll(/class="([^"$]*)/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith('org')) out.add(c);
    }
    return [...out];
  })();

  it('the instrument found the classes (a sweep over nothing proves nothing)', () => {
    // The control. If lineBlock is renamed or restructured, this fails and
    // tells the next reader to re-derive the subject — rather than sweeping an
    // empty list and reporting green, which is how house0116 scored 0
    // assertions across 23 migrations.
    expect(emitted.length).toBeGreaterThanOrEqual(8);
    expect(emitted).toContain('org-station-dot');
    expect(emitted).toContain('org-lines');
  });

  it.each([['the classes']])('%s all have at least one live rule', () => {
    const live = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const orphans = emitted.filter((c) => !live.includes(`.${c}`));
    expect(orphans, `no rule anywhere for: ${orphans.join(', ')}`).toEqual([]);
  });

  it('it reuses the SHARED person card rather than resurrecting its own', () => {
    // The deleted version had its own memberCard() emitting `.org-person`. Two
    // portrait renderers is how TREE_SHAPE and the CSS width drift apart, which
    // org-chart-metrics.test.js exists to catch — and it can only catch the
    // pair it knows about.
    const from = JS.indexOf('function lineBlock(');
    const to = JS.indexOf('function renderExpandAll(');
    const src = JS.slice(from, to);
    expect(src).toContain('peopleHtml(');
    expect(src).not.toContain('memberCard');
    expect(src).not.toMatch(/class="org-person/);
    // …and the stylesheet dresses THAT card, not a class nothing emits.
    expect(CSS).toContain('.org-lines .orgc-person');
    expect(CSS).not.toContain('.org-lines .org-person ');
  });

  it('one portrait width on the page, so the request matches the render', () => {
    // TREE_SHAPE's request sizes are computed from 3.25rem and pinned to the
    // shared rule by org-chart-metrics.test.js. A second width in this view
    // would ask the CDN for one size and paint another.
    const rule = /\.org-lines \.org-face \{[^}]*width:\s*3\.25rem/;
    expect(CSS).toMatch(rule);
  });
});

// ── §C. The key mapping ─────────────────────────────────────────────────────
describe('the view keys: a restore must not move anybody', () => {
  it('offers four views, and `chart` still means the PANEL view', () => {
    // ภาพรวม (2026-10-22) arrived as a NEW key, `overview`, for the same reason
    // `lines` did: no existing key changes meaning, so no saved preference moves.
    expect(JS).toContain("const VIEWS = ['overview', 'lines', 'chart', 'all']");
    // The restored connector tree historically owned `'chart'`. Giving it back
    // would silently send every reader whose saved preference is `'chart'` —
    // today the panel view — to a different picture. This is the assertion that
    // catches that, and it is worth more than it looks: the two are both
    // plausible pages, so nobody would report it as a bug.
    expect(JS).toMatch(/view === 'chart'[\s\S]{0,200}unitBlock/);
    expect(JS).toMatch(/view === 'lines' \? linesHtml/);
  });

  it('still migrates the two retired keys', () => {
    expect(JS).toContain("{ list: 'chart', graph: 'all' }");
  });

  it('all three buttons are rendered, each with its own Thai label', () => {
    for (const [key, label] of [['lines', 'ผังสายงาน'], ['chart', 'แผนผัง'], ['all', 'ผังรวม']]) {
      expect(JS).toContain(`data-org-view="${key}"`);
      expect(JS).toContain(label);
    }
    // Two views both called "แผนผัง" is not shippable — the names must differ.
    expect(new Set(['ผังสายงาน', 'แผนผัง', 'ผังรวม']).size).toBe(3);
  });

  it('one disclosure handler serves both DOM shapes', () => {
    // toggleNode resolves the panel through aria-controls, not through either
    // view's class names — so the second view cannot be the one that silently
    // stops toggling after a markup change.
    expect(JS).toMatch(/getElementById\(btn\.getAttribute\('aria-controls'\)/);
    expect(JS).toContain(".closest('.orgc-unit-btn, .org-station-btn')");
  });
});
