// ==============================================
// admin-order-modal.test.js — the delete button in the order detail modal.
//
// THE BUG. openOrderModal(orderId) repaints #shopAdminOrderModalBody with
// innerHTML on every open, then used to ALSO run
//   document.getElementById('shopAdminOrderModalDelete')?.addEventListener('click', deleteCurrentOrder)
// on every open. The delete button lives in the modal FOOTER
// (modal-shop-order-detail.html), outside the part that gets repainted, so
// it survives every open untouched — and so did every listener ever
// attached to it. Open order A, then B, then C, and a single click on
// "ลบคำสั่งซื้อ" fires deleteCurrentOrder() three times at once: three
// concurrent DELETE requests for the same row, a stacked confirm dialog,
// duplicate toasts. Exactly the shape my-house.test.js already pins for a
// different module ("the re-render trap") — a listener attached inside a
// function that repaints AROUND the node it is listening on, instead of
// around it once at mount time.
//
// No jsdom in this repo's test setup, so this pins the SOURCE the same way
// my-house.test.js does: structurally (by function body, not line number —
// see docs/mistakes/frontend-ui.md, "NEVER SLICE SOURCE BY LINE NUMBER"),
// not by running a browser.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./admin.js', import.meta.url), 'utf8');
// Comment lines stripped, same as my-house.test.js, so a test for the
// pattern doesn't fire on this file's OWN header describing it.
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** The body of a top-level `function NAME(...) { ... }`, found by counting
 *  braces from its opening one — structural, not a line range. */
function functionBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
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

const DELETE_LISTENER = /getElementById\(\s*['"]shopAdminOrderModalDelete['"]\s*\)\?\.addEventListener\(\s*['"]click['"]/;

describe('the order modal delete button', () => {
  it('is wired somewhere in the module — the feature still exists', () => {
    expect(CODE).toMatch(DELETE_LISTENER);
  });

  it('is NOT wired inside openOrderModal — that function runs on every open', () => {
    // openOrderModal repaints #shopAdminOrderModalBody on every call; the
    // delete button is outside that element and must be wired once, at
    // mount time, not from in here.
    expect(functionBody(CODE, 'openOrderModal')).not.toMatch(DELETE_LISTENER);
  });

  it('IS wired inside ensureMounted — guarded to run exactly once', () => {
    expect(functionBody(CODE, 'ensureMounted')).toMatch(DELETE_LISTENER);
  });
});
