// Every stylesheet PARSES — no warning from a real CSS parser.
//
// WHY. CSS fails silently: a broken rule is dropped, and stray text before a
// rule is read as part of the NEXT rule's selector, which is then dropped too.
// On 2026-10-15 deleting dead rules by line left `.x:active,` with no body in a
// reduced-motion block, and the body of `button.stat-card { … }` with no
// selector — the second would have swallowed the rule after it (the orders
// table's phone layout). `npm run build` and every other test passed. Vite
// (via esbuild) parses CSS anyway; this asks the same parser to say so.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const files = readdirSync('src/css').filter((f) => f.endsWith('.css')).map((f) => `src/css/${f}`);

describe('every stylesheet parses without a warning', () => {
  it('finds the stylesheets (the control)', () => {
    expect(files).toContain('src/css/shop.css');
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', async (file) => {
    const { warnings } = await transform(readFileSync(file, 'utf8'), { loader: 'css', sourcefile: file });
    expect(warnings.map((w) => `${w.location?.line}: ${w.text}`)).toEqual([]);
  });

  it('a stray declaration outside a rule IS reported (the guard can fail)', async () => {
    const { warnings } = await transform('.a { color: red; }\n  border: 0; width: 1px;\n}\n.b { color: blue; }', { loader: 'css' });
    expect(warnings.length).toBeGreaterThan(0);
  });
});
