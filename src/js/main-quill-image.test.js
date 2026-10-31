// ============================================================
// main-quill-image.test.js — the VS form's Quill image handler
// (makeQuillImageHandler in main.js) must never use a native alert() and
// must never delete its own placeholder down to nothing on failure.
//
// THE BUG (task 17's phone friction sweep). A student inserting a photo into
// their VitalSound report hits a network hiccup; the handler used to delete
// the "กำลังอัปโหลดรูป…" placeholder and alert() the error. Two retries in a
// row trips Chrome's "prevent this page from creating additional dialogs",
// after which alert() is a silent no-op — and because the placeholder was
// already deleted, the typed report loses that sentence with NOTHING to show
// for it. Fixed by replacing the placeholder with a visible failure note
// INSTEAD of alert(), so the editor itself always carries the outcome.
//
// No jsdom in this repo's test setup, so this pins the fix structurally — the
// same technique as vs-board-error-feedback.test.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const SRC = stripComments(readFileSync(new URL('./main.js', import.meta.url), 'utf8'));

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

describe('makeQuillImageHandler — a failed image insert never uses alert() or vanishes', () => {
  const body = functionBody(SRC, 'makeQuillImageHandler');

  it('calls no native alert()', () => {
    expect(body).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });

  it('on failure, says so UNDER the editor and never writes the error into the report text', () => {
    const catchIdx = body.search(/catch\s*\(/);
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).toMatch(/vsEditorNote\(`แทรกรูปไม่สำเร็จ/);
    // The earlier fix inserted the message into the Quill document, where a
    // student who missed it would submit it as part of the complaint.
    expect(catchBody).not.toMatch(/insertText\(/);
  });
});
