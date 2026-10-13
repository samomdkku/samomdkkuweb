// ============================================================
// vs-board-stale-fetch.test.js — vsBoardOpen() could paint a stale fetch
// over whatever the board is showing now.
//
// THE BUG. vsBoardOpen(id) sets openProblemId = id, then awaits
// get_public_vs_problem, then called renderProblemDetail(data)
// unconditionally. vs-tracking.js's enhanceBoardBanner() already has the
// right guard for the identical shape ("fire-and-forget; guards against a
// stale response after the user navigates to another ticket") — vs-board.js
// never got it. Concrete scenario: slow connection, a visitor taps problem
// A, then (before A's fetch resolves) taps problem B or hits "back" —
// openProblemId has already moved on (or gone null), but A's response still
// lands and overwrites #vsProblemBody with A's content on top of whatever B
// is now showing, or re-opens the detail view after the visitor went back
// to the list.
//
// No jsdom in this repo's test setup (see admin-order-modal.test.js), so
// this pins the fix structurally — the same guard shape enhanceBoardBanner
// already uses, in the right place relative to the await and the render
// call — rather than by running a browser.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./vs-board.js', import.meta.url), 'utf8');
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

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

describe('vsBoardOpen — stale async response guard', () => {
  const body = functionBody(CODE, 'vsBoardOpen');

  it('awaits the RPC before doing anything else with its result', () => {
    expect(body).toMatch(/await dbRest\(\s*['"]\/rpc\/get_public_vs_problem['"]/);
  });

  it('checks openProblemId has not moved on before rendering what came back', () => {
    expect(body).toMatch(/id\s*!==\s*openProblemId/);
  });

  it('the staleness check runs AFTER the await and BEFORE renderProblemDetail is called', () => {
    const awaitIdx = body.search(/await dbRest\(/);
    const guardIdx = body.search(/id\s*!==\s*openProblemId/);
    const renderIdx = body.search(/renderProblemDetail\(data\)/);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(awaitIdx);
    expect(guardIdx).toBeLessThan(renderIdx);
  });
});

// Behaviour, not shape: two loads of the SAME problem, answered out of order.
// The id check alone passes both (code review, 2026-10-13) — re-opening after
// a comment re-fetches the same id, so the OLDER thread could paint last.
describe('vsBoardOpen — two loads of the same problem, answered out of order', () => {
  it('paints the newer response, not the slower older one', async () => {
    const { vi } = await import('vitest');
    const resolvers = [];
    vi.doMock('./db.js', () => ({ dbRest: vi.fn(() => new Promise((r) => resolvers.push(r))) }));
    vi.doMock('./auth.js', () => ({ getUser: () => null }));
    vi.doMock('./vs-tracking.js', () => ({ VS_PHASES: [], renderVsStepperByPhase: () => '' }));
    const els = {};
    const el = () => ({ innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
    globalThis.document = { getElementById: (id) => (els[id] ||= el()), querySelector: () => null, querySelectorAll: () => [] };
    globalThis.window = globalThis.window || {};
    const { vsBoardOpen } = await import('./vs-board.js');

    const first = vsBoardOpen(7);
    const second = vsBoardOpen(7);                       // e.g. after posting a comment
    const problem = (marker) => ({ canonical_id: 'VS-7', public_note: marker, phase: 0, comments: [] });
    resolvers[1]({ data: problem('NEWER-THREAD'), error: null });
    await second;
    resolvers[0]({ data: problem('OLDER-THREAD'), error: null });
    await first;

    expect(els.vsProblemBody.innerHTML).toContain('NEWER-THREAD');
    expect(els.vsProblemBody.innerHTML).not.toContain('OLDER-THREAD');
    delete globalThis.document;
    vi.doUnmock('./db.js'); vi.doUnmock('./auth.js'); vi.doUnmock('./vs-tracking.js');
  });
});
