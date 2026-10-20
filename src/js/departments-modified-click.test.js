// A modified click (⌘/Ctrl/Shift/Alt) on a real link belongs to the browser.
// departments.js passes it through only for the attributes its selector names,
// so every <a href> that carries a dept-tool attribute ANYWHERE in the markup
// must be covered — asserted against the HTML, not a hand-kept list.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const src = readFileSync(join(root, 'src/js/departments.js'), 'utf8');
const passthrough = /if \(modified && e\.target\.closest\('([^']+)'\)\) return;/.exec(src)?.[1] || '';

const htmlDir = join(root, 'src/html');
const anchors = [];
for (const f of readdirSync(htmlDir).filter((n) => n.endsWith('.html'))) {
  const html = readFileSync(join(htmlDir, f), 'utf8');
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\shref=/.test(tag)) continue;
    const attr = /\s(data-dept-tool-(?:tab|path))=/.exec(tag)?.[1];
    if (attr) anchors.push({ f, attr });
  }
}

describe('departments.js — modified clicks on links', () => {
  it('finds the passthrough selector and at least one dept-tool link (control)', () => {
    expect(passthrough).not.toBe('');
    expect(anchors.length).toBeGreaterThan(0);
  });
  it('covers every attribute a real <a href> carries', () => {
    const missing = [...new Set(anchors.map((a) => a.attr))]
      .filter((attr) => !passthrough.includes(`a[href][${attr}]`));
    expect(missing).toEqual([]);
  });
});
