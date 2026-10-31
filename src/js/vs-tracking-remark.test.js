// ============================================================
// vs-tracking-remark.test.js — submitUserRemark() must not use a native
// alert() for its error path.
//
// THE BUG (task 17's phone friction sweep). Same shape as pr-tracking.js's
// refreshPRTicketDashboard: a failed reply used `alert('ส่งข้อความไม่สำเร็จ: '
// + ...)`, which goes silent for the rest of the page once a visitor has
// ticked Chrome's "prevent this page from creating additional dialogs" —
// reachable by retrying a reply a couple of times on a bad connection. The
// typed text was already preserved on failure (no `.value = ''` on this
// path); what was missing is TELLING the visitor it didn't go, instead of
// a dialog that may never show. Fixed with the same #userRemarkAlert inline
// box pattern every other form on this page already uses.
//
// No jsdom here — structural pin on the real source, same technique as
// vs-board-stale-fetch.test.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const SRC = stripComments(readFileSync(new URL('./vs-tracking.js', import.meta.url), 'utf8'));

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

describe('submitUserRemark — error path uses the inline box, not alert()', () => {
  const body = functionBody(SRC, 'submitUserRemark');

  it('calls no native alert()', () => {
    expect(body).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });

  it('reads and clears #userRemarkAlert at the start of a run', () => {
    expect(body).toMatch(/getElementById\(\s*['"]userRemarkAlert['"]\s*\)/);
  });

  it('still never clears the typed text on the error path (a retry must not lose the draft)', () => {
    const catchIdx = body.search(/catch\s*\(/);
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).not.toMatch(/userRemarkInput['"]\)\.value\s*=/);
  });
});
