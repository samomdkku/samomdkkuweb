// Guards for read-file.js — reading a picked File where a person is waiting.
//
// The bug: a slip that previewed fine failed to read at submit time
// (NotReadableError — the phone had revoked the handle), and `r.onerror =
// reject` handed the ProgressEvent to a toast that printed `${e.message || e}`:
// "สั่งซื้อไม่สำเร็จ: [object ProgressEvent]" (2026-09-22). The public PR form's
// copy had no onerror at all, so the same failure there was an endless spinner.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readAsDataURL, holdInMemory, FILE_UNREADABLE_MESSAGE } from './read-file.js';
import { stripComments } from './strip-comments.js';

/** A FileReader whose read fails the way a revoked phone file does. */
class FailingReader {
  readAsDataURL() {
    this.error = { name: 'NotReadableError', message: 'could not be read' };
    // The real thing hands onerror a ProgressEvent — an object with no .message.
    queueMicrotask(() => this.onerror?.({ type: 'error', target: this }));
  }
}
class OkReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,AAAA';
    queueMicrotask(() => this.onload?.({ target: this }));
  }
}

const realReader = globalThis.FileReader;
afterEach(() => { globalThis.FileReader = realReader; });

describe('readAsDataURL', () => {
  it('resolves with the data URL', async () => {
    globalThis.FileReader = OkReader;
    await expect(readAsDataURL(new Blob(['x']))).resolves.toBe('data:image/png;base64,AAAA');
  });

  it('rejects with an Error a person can read, never the event', async () => {
    globalThis.FileReader = FailingReader;
    const err = await readAsDataURL(new Blob(['x'])).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(FILE_UNREADABLE_MESSAGE);
    // What the checkout toast actually renders:
    expect(`สั่งซื้อไม่สำเร็จ: ${err?.message || err}`).not.toMatch(/\[object /);
  });
});

describe('holdInMemory', () => {
  it('returns a File that still reads after the original stops being readable', async () => {
    let readable = true;
    const picked = {
      name: 'slip.png', type: 'image/png', lastModified: 1,
      arrayBuffer: async () => {
        if (!readable) throw new DOMException('gone', 'NotReadableError');
        return new TextEncoder().encode('slip-bytes').buffer;
      },
    };
    const held = await holdInMemory(picked);
    readable = false; // the phone revokes the handle while the buyer is away
    await expect(picked.arrayBuffer()).rejects.toThrow();
    expect(await held.text()).toBe('slip-bytes');
    expect(held.name).toBe('slip.png');
    expect(held.type).toBe('image/png');
  });

  it('turns an unreadable pick into the same readable Error', async () => {
    const picked = { name: 'a', type: 'image/png', arrayBuffer: async () => { throw new DOMException('x', 'NotReadableError'); } };
    await expect(holdInMemory(picked)).rejects.toThrow(FILE_UNREADABLE_MESSAGE);
  });
});

describe('no promised FileReader leaks its event or hangs', () => {
  // Walk the tree, not a list of today's files — a new copy must not slip in.
  function jsFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) jsFiles(full, out);
      else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
    }
    return out;
  }
  const files = [...jsFiles('src/js'), ...jsFiles('passport/js')];
  // A FileReader created inside a `new Promise(` — the shape whose failure
  // either rejects with the raw event or never settles.
  const PROMISED_READER = /new Promise\([^]{0,160}?new FileReader\(\)[^]{0,400}?\n\s*\}\);/g;

  it('has a control — the sweep sees promised readers', () => {
    const hits = files.flatMap((f) => readFileSync(f, 'utf8').match(PROMISED_READER) || []);
    expect(hits.length).toBeGreaterThanOrEqual(3); // read-file, admin-main, passport upload
  });

  it('every one has an onerror, and none rejects with the event itself', () => {
    const offenders = [];
    for (const f of files) {
      for (const block of readFileSync(f, 'utf8').match(PROMISED_READER) || []) {
        if (!/\.onerror\s*=/.test(block) || /\.onerror\s*=\s*reject\b/.test(block)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('every picked file is either held or read in its own handler', () => {
  // A REGISTRY, not a pattern: whether a pick is read at once or parked until a
  // save is a decision a regex cannot see. The count is how many `.files`
  // references the module has (comments stripped); a new one turns this red
  // until someone decides which kind it is. The slip bug was a parked pick.
  //   held      — parked until save; must copy the bytes (holdInMemory/All)
  //   immediate — read inside the pick handler (or cropped, which returns an
  //               in-memory File), so nothing waits between pick and read
  const REGISTRY = {
    'src/js/shop/checkout.js':    { n: 2, kind: 'held' },      // slip → onSlipChosen
    'src/js/pr-form.js':          { n: 9, kind: 'held' },      // heldPrFiles
    'src/js/projects/send.js':    { n: 2, kind: 'held' },      // stageFiles
    'src/js/dept-page-admin.js':  { n: 1, kind: 'held' },      // `pending` map
    'src/js/house/index.js':      { n: 2, kind: 'held' },      // house icon; CSV is .text() at once
    'src/js/shop/admin.js':       { n: 6, kind: 'held' },      // batch + product image; QR/banner at once
    'src/js/my-seat.js':          { n: 1, kind: 'immediate' }, // cropImage
    'src/js/team/index.js':       { n: 2, kind: 'immediate' }, // cropImage; import .text()
    'src/js/team/terms.js':       { n: 1, kind: 'immediate' }, // onArchivePhoto → cropImage
    'src/js/projects/inbox.js':   { n: 3, kind: 'immediate' }, // uploads in the handler
    'src/js/shop/orders.js':      { n: 2, kind: 'immediate' }, // handleSlipAdd
    'src/js/shop/qr.js':          { n: 1, kind: 'immediate' }, // scanFile
    'src/js/main.js':             { n: 2, kind: 'immediate' }, // quill image upload
    'src/js/admin-main.js':       { n: 4, kind: 'immediate' }, // quill upload; cover → cropper
    'passport/js/admin-page.js':  { n: 2, kind: 'immediate' }, // doUpload
    'passport/js/dashboard.js':   { n: 4, kind: 'immediate' }, // FileReader in the handler
  };

  function jsFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) jsFiles(full, out);
      else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
    }
    return out;
  }
  const counts = {};
  for (const f of [...jsFiles('src/js'), ...jsFiles('passport/js')]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const n = (src.match(/\.files\b/g) || []).length;
    if (n) counts[f] = { n, src };
  }

  it('has a control — the sweep finds the file the bug was in', () => {
    expect(counts['src/js/shop/checkout.js']?.n).toBeGreaterThan(0);
  });

  it('knows every module that takes a picked file, at its current count', () => {
    const seen = Object.fromEntries(Object.entries(counts).map(([f, { n }]) => [f, n]));
    const want = Object.fromEntries(Object.entries(REGISTRY).map(([f, { n }]) => [f, n]));
    expect(seen).toEqual(want);
  });

  it('every held module really copies the bytes', () => {
    const missing = Object.entries(REGISTRY)
      .filter(([f, { kind }]) => kind === 'held' && !/\bhold(All)?InMemory\(/.test(counts[f]?.src || ''))
      .map(([f]) => f);
    expect(missing).toEqual([]);
  });
});
