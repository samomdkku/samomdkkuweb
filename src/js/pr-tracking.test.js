// ============================================================
// pr-tracking.test.js — refreshPRTicketDashboard() must not use a native
// alert() for its error paths.
//
// THE BUG (found by task 17's phone friction sweep). A visitor who taps the
// ติดตามสถานะ dashboard's รีเฟรช button a few times in a row (a flaky
// connection is exactly when they'd do that) can trip Chrome's "prevent this
// page from creating additional dialogs" checkbox — after which `alert()`
// shows NOTHING, silently, for the rest of the page's life. The very visitor
// most likely to hit an error here is the one most likely to retry it into
// silence. Fixed by routing both error branches (not-found, network) through
// the same #prDashAlert inline box the rest of this screen already uses.
//
// No jsdom in this repo's test setup, so this pins the fix structurally, the
// same way vs-board-stale-fetch.test.js does — read the real source, not a
// browser.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const SRC = stripComments(readFileSync(new URL('./pr-tracking.js', import.meta.url), 'utf8'));

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

describe('refreshPRTicketDashboard — error paths use the inline box, not alert()', () => {
  const body = functionBody(SRC, 'refreshPRTicketDashboard');

  it('calls no native alert()', () => {
    expect(body).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });

  it('reads and clears #prDashAlert at the start of a run', () => {
    expect(body).toMatch(/getElementById\(\s*['"]prDashAlert['"]\s*\)/);
  });

  it('shows the not-found case in the alert box', () => {
    expect(body).toMatch(/ไม่พบ Ticket นี้/);
  });

  it('shows the network-failure case in the alert box, not a dialog', () => {
    expect(body).toMatch(/เชื่อมต่อเครือข่ายล้มเหลว/);
  });
});
