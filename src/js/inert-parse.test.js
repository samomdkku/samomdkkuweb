// Stored HTML is parsed with DOMParser, never into a detached element.
//
// `document.createElement('div').innerHTML = post.content` looks inert and is
// not: the element belongs to the live document, so every <img> in the string
// is fetched at once, attached or not. announcements.js did it to find a
// post's first picture and its snippet, for every post, on every page load —
// the shop tab downloaded ~45 MB of news pictures nobody could see
// (docs/mistakes/frontend-ui.md). DOMParser builds a document with no browsing
// context, which loads nothing.
//
// Shape swept: a detached element whose innerHTML is set from DATA (a variable
// or property, not a call that builds our own markup, as my-seat.js does).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return p.endsWith('.js') && !p.endsWith('.test.js') ? [p] : [];
  });
}

// `const x = document.createElement('div');` then, before any statement that
// attaches x, `x.innerHTML = <identifier chain>` (optionally `|| ''`).
const DETACHED_DATA_PARSE = /(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(\s*['"]\w+['"]\s*\);\s*\n\s*\1\.innerHTML\s*=\s*[\w.?]+(?:\s*\|\|\s*(?:''|""))?\s*;/g;

const hits = (src) => [...src.matchAll(DETACHED_DATA_PARSE)].map((m) => m[0].split('\n')[0].trim());

describe('stored HTML is parsed inert', () => {
  it('the sweep sees the files', () => {
    expect(jsFiles('src/js').length).toBeGreaterThan(50);
  });

  it('control — the pattern is caught when present', () => {
    const bad = "function f(post) {\n  const tempDiv = document.createElement('div');\n  tempDiv.innerHTML = post.content || '';\n}";
    expect(hits(bad)).toHaveLength(1);
    const ours = "const next = document.createElement('div');\n    next.innerHTML = studyYearFieldHtml(x);";
    expect(hits(ours)).toHaveLength(0);   // our own markup, built by a call
  });

  it('no module parses data into a detached element', () => {
    const found = jsFiles('src/js').flatMap((f) =>
      hits(stripComments(readFileSync(f, 'utf8'))).map((h) => `${f}: ${h}`));
    expect(found).toEqual([]);
  });
});
