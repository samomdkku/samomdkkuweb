// ============================================================
// vs-board-error-feedback.test.js — two silent-failure shapes found by task
// 17's phone friction sweep on the public VitalSound board.
//
// 1. vsPostComment() used a native alert() for its error path — same hazard
//    as pr-tracking.js/vs-tracking.js (silenced by Chrome's "prevent this
//    page from creating additional dialogs" after a few retries). Fixed with
//    an inline #vsCommentAlert box next to the composer.
// 2. vsBoardMeToo() did `if (error) { return; }` — a FAILED "เจอเหมือนกัน" tap
//    looked IDENTICAL to one that silently did nothing, because the button's
//    own state (is-on, the count) is deliberately left untouched either way.
//    There was no other feedback: not a dialog, not text, nothing. Fixed
//    with an aria-live announcement (#vsBoardAnnounce) plus a transient
//    `.is-error` class on the button for sighted users.
//
// No jsdom here — structural pin on the real source, same technique as
// vs-board-stale-fetch.test.js (this file's sibling).
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const RAW = readFileSync(new URL('./vs-board.js', import.meta.url), 'utf8');
const SRC = stripComments(RAW);

function functionBody(src, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return src.slice(start, i - 1);
}

describe('vsPostComment — error path uses the inline box, not alert()', () => {
  const body = functionBody(SRC, 'vsPostComment');

  it('calls no native alert()', () => {
    expect(body).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });

  it('reads and clears #vsCommentAlert at the start of a run', () => {
    expect(body).toMatch(/getElementById\(\s*['"]vsCommentAlert['"]\s*\)/);
  });

  it('shows the error on the box it just cleared, on the error branch', () => {
    const errIdx = body.search(/if\s*\(\s*error\s*\)/);
    expect(errIdx).toBeGreaterThan(-1);
    expect(body.slice(errIdx)).toMatch(/alertBox[\s\S]*classList\.remove\(\s*['"]d-none['"]\s*\)/);
  });
});

describe('vsBoardMeToo — a failed tap is no longer indistinguishable from a no-op', () => {
  const body = functionBody(SRC, 'vsBoardMeToo');
  const errIdx = body.search(/if\s*\(\s*error\s*\)/);

  it('still has a dedicated error branch', () => {
    expect(errIdx).toBeGreaterThan(-1);
  });

  it('announces the failure (not a bare `return`)', () => {
    expect(body.slice(errIdx)).toMatch(/announce\(/);
  });

  it('gives sighted users a visible signal too', () => {
    expect(body.slice(errIdx)).toMatch(/classList\.add\(\s*['"]is-error['"]\s*\)/);
  });
});

describe('announce() — the aria-live region actually changes on repeat use', () => {
  it('clears the node before writing the new text (a second identical message must still announce)', () => {
    const m = /function announce\(text\)\s*\{([\s\S]*?)\n\}/.exec(SRC);
    expect(m, 'announce() not found').toBeTruthy();
    const body = m[1];
    const clearIdx = body.search(/textContent\s*=\s*['"]['"]/);
    const setIdx = body.search(/textContent\s*=\s*text/);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(clearIdx);
  });
});
