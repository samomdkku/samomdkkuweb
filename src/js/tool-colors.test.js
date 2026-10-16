// tool-colors.test.js — tool icon colours, glyphs and ฝ่าย logos.
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../data/tools.js';
import { DEPT_DEFS } from '../data/depts.js';
import { readFileSync } from 'node:fs';
import { renderToolCard } from './tool-card.js';

describe('tool icon glyphs', () => {
  // White on every colour is the owner's decision (2026-10-16), so this does
  // not hold colours to a contrast ratio. What it holds: white really is what
  // the stylesheet paints, and the edge shadow that keeps a white glyph
  // findable on a pale square has not been dropped.
  const css = readFileSync(new URL('../css/launcher.css', import.meta.url), 'utf8');
  it('the glyph is white unless a tool names its own ink, with the soft edge shadow', () => {
    const rule = css.match(/\.launcher-tool-icon \{([^}]*)\}/)[1];
    expect(rule).toMatch(/color:\s*var\(--tool-ink, #ffffff\)/);
    expect(css).toMatch(/\.launcher-tool-icon i \{ filter: drop-shadow\(/);
    const inked = TOOLS.filter((t) => t.ink).map((t) => t.slug);
    expect(inked, 'only the shop carries its own mark colour').toEqual(['shop']);
  });

  it('SAMO Shop is the banner\'s mark: the same glyph, and the storefront\'s own colours', () => {
    const shop = TOOLS.find((t) => t.slug === 'shop');
    const home = readFileSync(new URL('../html/tab-home.html', import.meta.url), 'utf8');
    const sf = readFileSync(new URL('../css/shop-storefront.css', import.meta.url), 'utf8');
    expect(home).toContain(`hero-shop-badge"><i class="bi ${shop.icon}"`);
    expect(sf).toMatch(new RegExp(`--sf-espresso:\\s*${shop.color}`, 'i'));
    expect(sf).toMatch(new RegExp(`--sf-milk:\\s*${shop.ink}`, 'i'));
    expect(renderToolCard(shop)).toContain(`--tool-ink: ${shop.ink}`);
  });
  it('every icon colour is a real colour', () => {
    const bad = TOOLS.filter((t) => !/^#[0-9a-f]{6}$|^var\(--[\w-]+\)$/i.test(t.color || '')).map((t) => t.slug);
    expect(bad).toEqual([]);
  });
});

describe('a tool drawn with its ฝ่าย\'s logo', () => {
  const withLogo = TOOLS.filter((t) => t.deptLogo);

  it('MDI and RT use theirs', () => {
    expect(withLogo.map((t) => t.slug).sort()).toEqual(['mdi-website', 'rt-website']);
  });

  it('every one names a ฝ่าย that HAS a logo, and renders it', () => {
    for (const t of withLogo) {
      const logo = DEPT_DEFS[t.dept]?.logo;
      expect(logo, `${t.slug}: ฝ่าย ${t.dept} has no logo`).toBeTruthy();
      const html = renderToolCard(t);
      expect(html).toContain(`src="${logo}"`);
      expect(html).not.toContain(`bi ${t.icon}`);
    }
  });
});
