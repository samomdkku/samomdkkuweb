// Dark mode (2026-10-13) — the guards that keep it whole.
//
// 1. The theme is applied BEFORE first paint by a head script in BOTH entry
//    HTMLs, and owned afterwards by theme.js. Two halves of one rule: the key
//    and the attributes must match, or a choice saved by one is ignored by the
//    other (mistakes class 6 — and "fixing one entry and not the other is this
//    repo's most repeated shape").
// 2. The colours are TOKENS. tools/theme-tokens-codemod.mjs rewrote every
//    neutral literal into one; a dry run must find nothing new, or a later CSS
//    change has slipped a colour past dark mode.
// 3. Light mode must not change: every mix amount is 100% in :root, and every
//    token theme.css flips exists in light too.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { THEME_KEY, MODES, resolveTheme } from './theme.js';
import { rewriteCss, SKIP_FILES } from '../../tools/theme-tokens-codemod.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

describe('resolveTheme', () => {
  it('a saved choice wins; while dark is dormant, auto is LIGHT even on a dark device', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('auto', true)).toBe('light');
    expect(resolveTheme('auto', false)).toBe('light');
  });
  it('dormant means dormant: no switch on any page, no device-following head script', () => {
    for (const f of ['index.html', 'admin/index.html', 'src/html/navbar.html']) {
      expect(read(f), f).not.toContain('data-theme-switch');
      expect(read(f), f).not.toMatch(/data-samo="theme">[\s\S]*prefers-color-scheme[\s\S]*?<\/script>/);
    }
  });
  it('offers exactly auto / light / dark', () => {
    expect(MODES.map((m) => m.value)).toEqual(['auto', 'light', 'dark']);
  });
});

describe('both entries apply the theme before first paint, the same way theme.js does', () => {
  for (const file of ['index.html', 'admin/index.html']) {
    const html = read(file);
    const m = html.match(/<script data-samo="theme">([\s\S]*?)<\/script>/);
    it(`${file} carries the head script`, () => { expect(m).toBeTruthy(); });
    it(`${file}: same storage key and attributes as theme.js`, () => {
      expect(m[1]).toContain(`'${THEME_KEY}'`);
      for (const attr of ['data-theme', 'data-theme-mode', 'data-bs-theme']) expect(m[1]).toContain(`'${attr}'`);
    });
    it(`${file}: the head script runs before any stylesheet or module`, () => {
      const at = html.indexOf('data-samo="theme"');
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(html.indexOf('<link'));
      expect(at).toBeLessThan(html.search(/<script type="module"/) === -1 ? Infinity : html.search(/<script type="module"/));
    });
    it(`${file}: its inline first-paint styles have a dark variant`, () => {
      const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join('\n');
      expect(styles).toMatch(/:root\[data-theme="dark"\] body/);
    });
  }
});

describe('the colours are tokens (no new literal slips past dark mode)', () => {
  const files = readdirSync(join(ROOT, 'src/css')).filter((f) => f.endsWith('.css') && !SKIP_FILES.has(f));
  it('reads the CSS at all', () => { expect(files.length).toBeGreaterThan(30); });
  it('a dry run of the codemod changes nothing in any file', () => {
    const dirty = files.filter((f) => rewriteCss(read(`src/css/${f}`), f).changed > 0);
    expect(dirty, `run: node tools/theme-tokens-codemod.mjs --write   (files: ${dirty.join(', ')})`).toEqual([]);
  });
  it('control: the codemod DOES catch a raw neutral and a pale tint', () => {
    expect(rewriteCss('.x{color:#0f172a;background:#fef3c7}').changed).toBe(2);
  });
});

describe('light mode is unchanged by construction', () => {
  const base = postcss.parse(read('src/css/base.css'));
  const rootDecls = {};
  base.walkRules(':root', (r) => r.walkDecls((d) => { rootDecls[d.prop] = d.value; }));
  it('every mix amount is 100% in light', () => {
    for (const k of ['--tint-mix', '--line-mix', '--fg-mix']) expect(rootDecls[k]).toBe('100%');
  });
  it('every token theme.css sets on :root in dark has a light value in base.css', () => {
    const theme = postcss.parse(read('src/css/theme.css'));
    const flipped = [];
    theme.walkRules((r) => { if (r.selector.trim() === ':root[data-theme="dark"]') r.walkDecls((d) => { if (d.prop.startsWith('--') && !d.prop.startsWith('--bs-') && d.prop !== '--page-bg') flipped.push(d.prop); }); });
    expect(flipped.length).toBeGreaterThan(20);
    const missing = flipped.filter((p) => !(p in rootDecls));
    expect(missing).toEqual([]);
  });
});
