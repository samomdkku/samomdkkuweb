// Guard for the bug this module was extracted to kill.
//
// SYMPTOM AS REPORTED: "ถ้าคนกรอกงาน PR form เข้ามาแบบแนบลิ้งค์ ลิ้งค์จะขึ้นใน
// discord แต่ไม่ได้ขึ้นใน PR Staff Dashboard" — the staff had to check two
// places and things fell through.
//
// The staff modal gated the whole attachment block on
// `file_url.startsWith('http')`. A ticket whose ONLY attachment is a pasted
// link stores `ลิงก์เสริม: https://…`, which does not, so 23% of live
// tickets rendered "ไม่มีไฟล์แนบ (No file)" to the people the link is for.
//
// Two assertions matter here and neither is about a string:
//   1. a link-only blob produces a link (the bug), and
//   2. the SOURCE of both views contains no second reading of file_url —
//      the staff copy and the tracking copy were the same rule written
//      twice, which is how they drifted apart in the first place.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from './strip-comments.js';
import { parsePrAttachments, hasPrAttachments, renderPrAttachments } from './pr-attachments.js';

const here = dirname(fileURLToPath(import.meta.url));
// Comments are stripped with the shared scanner, never a regex: this file's
// own prose names ลิงก์เสริม, and a guard that reads prose reports the
// opposite of the truth (see strip-comments.js).
const read = (f) => stripComments(readFileSync(join(here, f), 'utf8'));

const LINK = 'https://drive.google.com/drive/folders/1VO0gV2UhERtsnBUc3LBCsC9euUIMRpRX';
const IMG1 = 'https://drive.google.com/file/d/AAA/view';
const IMG2 = 'https://drive.google.com/file/d/BBB/view';

describe('parsePrAttachments', () => {
  it('finds the link in a LINK-ONLY ticket (the reported bug)', () => {
    const items = parsePrAttachments(`ลิงก์เสริม: ${LINK}`);
    expect(items).toEqual([{ kind: 'link', url: LINK, index: 1 }]);
    expect(hasPrAttachments(`ลิงก์เสริม: ${LINK}`)).toBe(true);
  });

  it('finds images and a link together, numbering images from 1', () => {
    const items = parsePrAttachments(`${IMG1}\n${IMG2}\nลิงก์เสริม: ${LINK}`);
    expect(items.map((i) => i.kind)).toEqual(['image', 'image', 'link']);
    expect(items.map((i) => i.index)).toEqual([1, 2, 1]);
  });

  it('numbers images by KIND, not array position', () => {
    // The old renderers used the array index, which was only ever right
    // because the form happens to write every image before the link.
    const items = parsePrAttachments(`ลิงก์เสริม: ${LINK}\n${IMG1}`);
    expect(items.find((i) => i.kind === 'image').index).toBe(1);
  });

  it('treats every "nothing attached" spelling as empty', () => {
    // null/'' are live rows; 'ไม่มีไฟล์แนบ' is 9 rows from the Sheets
    // import; '-' is the display placeholder both views coerce to.
    for (const empty of [null, undefined, '', '   ', '-', 'ไม่มีไฟล์แนบ']) {
      expect(parsePrAttachments(empty)).toEqual([]);
      expect(hasPrAttachments(empty)).toBe(false);
    }
  });

  it('drops a ลิงก์เสริม line with no url after it', () => {
    expect(parsePrAttachments('ลิงก์เสริม:')).toEqual([]);
    expect(parsePrAttachments('ลิงก์เสริม:   ')).toEqual([]);
  });
});

describe('renderPrAttachments', () => {
  it('renders an anchor to the pasted link, not the no-file chip', () => {
    const html = renderPrAttachments(`ลิงก์เสริม: ${LINK}`);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).not.toContain('ไม่มีไฟล์แนบ');
  });

  it('shows the no-file chip only when nothing is attached', () => {
    expect(renderPrAttachments(null)).toContain('ไม่มีไฟล์แนบ');
    expect(renderPrAttachments(`${IMG1}`)).not.toContain('ไม่มีไฟล์แนบ');
  });

  it('neutralises a javascript: url a guest could paste', () => {
    // largeFileLink is free text on the PUBLIC form and this HTML goes
    // through innerHTML in both views.
    const html = renderPrAttachments('ลิงก์เสริม: javascript:alert(1)');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('escapes a url that tries to break out of the href', () => {
    const html = renderPrAttachments('ลิงก์เสริม: https://x.test/" onmouseover="alert(1)');
    expect(html).not.toContain('onmouseover="alert(1)"');
    // The PROPERTY, not the mechanism (it was `&quot;`; safeUrl now
    // percent-encodes the quote first): the payload stays INSIDE the href.
    expect(html).toMatch(/href="[^"]*onmouseover[^"]*"/);
  });

  it('opens links in a new tab without handing over window.opener', () => {
    const html = renderPrAttachments(`ลิงก์เสริม: ${LINK}`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('one reading of file_url', () => {
  // The differential half. Both views must ASK this module; neither may
  // re-implement the split. Control: the shared module itself does own
  // the marker, so an empty result here would be the test rotting.
  const VIEWS = ['pr-staff.js', 'pr-tracking.js'];

  it('the module under test is the one place that knows the marker', () => {
    expect(read('pr-attachments.js')).toContain('ลิงก์เสริม:'); // control
  });

  for (const view of VIEWS) {
    it(`${view} asks pr-attachments.js instead of parsing file_url itself`, () => {
      const src = read(view);
      expect(src).toContain("from './pr-attachments.js'");
      // The two tells of a re-implementation: the marker literal, and the
      // startsWith('http') gate that hid link-only tickets.
      expect(src).not.toMatch(/['"`]ลิงก์เสริม:/);
      expect(src).not.toMatch(/\.startsWith\(\s*['"`]http/);
    });
  }
});
