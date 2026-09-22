// Every class the shop's picture code EMITS has a CSS rule in a stylesheet the
// PAGE THAT RENDERS IT loads.
//
// The first gallery build put the admin picture strip's rules in
// shop-storefront.css. /admin/ never loads that file (src/admin.css imports
// shop.css only), so every tile rendered as a bare, full-size image — and
// nothing failed: a dead rule looks exactly like a feature nobody built
// (mistakes class 6). The property is "loaded by THIS entry", not "exists
// somewhere", so the stylesheet lists come from each entry's own @imports.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

/** The CSS an entry actually loads: its file plus every @import, one level. */
function entryCss(entry) {
  const src = read(entry);
  const dir = entry.slice(0, entry.lastIndexOf('/') + 1);
  const imports = [...src.matchAll(/@import\s+['"]([^'"]+\.css)['"]/g)].map((m) => dir + m[1].replace(/^\.\//, ''));
  return { files: imports, text: [src, ...imports.map(read)].join('\n') };
}

const CASES = [
  // [module that emits, class pattern, the entry whose page renders it]
  ['src/js/shop/admin.js',   /(?<![-\w])shop-img-[a-z-]+/g, 'src/admin.css'],
  ['src/js/shop/gallery.js', /(?<![-\w])pg-[a-z-]+/g,        'src/main.css'],
];

describe('shop picture classes have rules where they are rendered', () => {
  it('reads each entry\'s imports (the control)', () => {
    expect(entryCss('src/admin.css').files).toContain('src/css/shop.css');
    expect(entryCss('src/main.css').files).toContain('src/css/shop-storefront.css');
  });

  it.each(CASES)('%s', (mod, re, entry) => {
    const used = [...new Set(read(mod).match(re) || [])];
    expect(used.length, `no ${re} classes found in ${mod} — the pattern is stale`).toBeGreaterThan(0);
    const { text } = entryCss(entry);
    const missing = used.filter((c) => !new RegExp(`\\.${c}(?![-\\w])`).test(text));
    expect(missing, `classes ${mod} emits with no rule in what ${entry} loads`).toEqual([]);
  });
});
