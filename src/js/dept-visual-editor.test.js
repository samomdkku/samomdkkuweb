// ==============================================
// THE VISUAL EDITOR IS ADMIN-ONLY, LAZY, AND ITS OUTPUT IS SELF-CONTAINED.
//
// GrapesJS is 1.15 MB (measured from the build). Three properties keep that
// affordable, and every one of them is easy to lose in a refactor that looks
// harmless:
//
//   1. it is reached only from a dynamic import, so nobody downloads it before
//      pressing the button;
//   2. it never enters the PUBLIC entry, which is what a student's phone loads;
//   3. its output carries its own CSS, because the sandboxed frame it lands in
//      is a BLANK document — no Bootstrap, no site stylesheet, no fonts.
//
// (3) is the one that would have shipped broken. A block built from Bootstrap
// classes looks perfect in the editor — which is inside the styled admin page —
// and completely unstyled on the real ฝ่าย page, and only a screenshot of the
// PUBLIC page would ever show it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { wrapDocument, unwrapDocument, forceExternalLinks, BLOCKS, CAT } from './dept-visual-editor.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'src', 'js', 'dept-visual-editor.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'src', 'js', 'dept-page-admin.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('the 1.15 MB stays where it belongs', () => {
  it('grapesjs is reached ONLY through a dynamic import', () => {
    // A static `import grapesjs from 'grapesjs'` anywhere folds it into
    // whichever entry bundle imports that module — silently, with no error.
    expect(SRC, 'grapesjs is imported statically — it would enter a bundle')
      .not.toMatch(/^import .* from ['"]grapesjs/m);
    expect(SRC).toMatch(/import\(\s*['"]grapesjs['"]\s*\)/);
  });

  it('its CSS is dynamic too', () => {
    // A static CSS import is extracted into the entry's stylesheet, so the
    // 60 KB would ship to everyone even though the JS did not.
    expect(SRC).toMatch(/import\(\s*['"]grapesjs\/dist\/css/);
  });

  it('is pinned to an exact version — it is pre-1.0', () => {
    expect(PKG.dependencies.grapesjs, 'grapesjs is on a floating range; its API '
      + 'moves between 0.x minors').toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is imported by the ADMIN surface only, never a public module', () => {
    const importers = readdirSync(join(ROOT, 'src', 'js'))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => f !== 'dept-visual-editor.js')
      .filter((f) => /from '\.\/dept-visual-editor\.js'/
        .test(readFileSync(join(ROOT, 'src', 'js', f), 'utf8')));
    expect(importers.sort(), 'a module outside the หน้าฝ่าย editor imports the '
      + 'visual editor — check it is not on a public path')
      .toEqual(['dept-page-admin.js']);
  });
});

describe('the output survives a BLANK document', () => {
  it('carries its own <style>, because the sandbox has no stylesheet', () => {
    const out = wrapDocument('<p>hi</p>', '');
    expect(out).toMatch(/<style>/);
    expect(out, 'no font is declared, so Thai falls back to a serif default')
      .toMatch(/Noto Sans Thai/);
  });

  it('reports its height from BODY, never documentElement', () => {
    // Inside an iframe `documentElement` IS the frame, so measuring it asks the
    // host how tall the host made it and the block can never shrink. That bug
    // already shipped once on the tool frame.
    expect(SRC).toMatch(/document\.body\.getBoundingClientRect/);
    expect(SRC, 'it measures documentElement — the frame can never shrink')
      .not.toMatch(/documentElement\.scrollHeight/);
    expect(wrapDocument('<p>hi</p>', '')).toMatch(/samo-embed-height/);
  });

  it('round-trips: what it wraps, it can unwrap', () => {
    // Otherwise re-opening the editor shows the wrapper as content, and each
    // open nests another copy of the base stylesheet inside the last.
    const authored = '<p>สวัสดี</p>';
    const back = unwrapDocument(wrapDocument(authored, ''));
    expect(back).toBe(authored);
  });

  it('leaves hand-written HTML alone', () => {
    // The PR road and the GUI road share one column. A block this editor did
    // not write must come back byte-for-byte, or opening the editor on someone
    // else's markup would eat their <style>.
    const hand = '<style>.a{color:red}</style><div class="a">มือเขียน</div>';
    expect(unwrapDocument(hand)).toBe(hand);
  });
});

describe('the blocks cannot produce a laptop-only layout', () => {
  it('has blocks at all (control)', () => {
    expect(BLOCKS.length).toBeGreaterThan(4);
  });

  it('uses no media query — columns stack by flex-wrap', () => {
    // A breakpoint is a thing a non-designer gets wrong. `flex: 1 1 260px`
    // wraps on its own when there is no room, with nothing to configure.
    //
    // ✅ MEASURED in a real browser at a 364px content width on 2026-09-11,
    // after a screenshot appeared to show it failing: every child lands on its
    // OWN ROW at full width. Flex breaks lines on the hypothetical main size,
    // so 260+260+16 > 364 wraps BEFORE flex-shrink gets a say. The screenshot
    // was taken in a harness with no <meta name="viewport">, so Chrome laid it
    // out at 980px and scaled down. ⚠️ Do not "fix" this to grid auto-fit on
    // the strength of a screenshot; measure the CHILDREN's rects.
    const html = BLOCKS.map((b) => (typeof b.content === 'string' ? b.content : '')).join('');
    expect(html, 'a block carries a media query').not.toMatch(/@media/);
    expect(html, 'no block declares a wrapping flex basis, so columns would be '
      + 'fixed and overflow a phone').toMatch(/flex:\s*1 1 \d+px/);
    expect(html).toMatch(/flex-wrap:\s*wrap/);
  });

  it('styles inline, never with Bootstrap classes', () => {
    // Bootstrap does not exist in the sandboxed frame. A `class="row"` block
    // looks right in this editor and unstyled on the real page.
    const html = BLOCKS.map((b) => (typeof b.content === 'string' ? b.content : '')).join('');
    for (const cls of ['class="row"', 'class="col', 'class="btn', 'class="card']) {
      expect(html, `a block uses ${cls} — Bootstrap is not loaded in the frame`)
        .not.toContain(cls);
    }
  });
});

describe('it adds no second way to save', () => {
  it('performs no database write of its own', () => {
    // The whole point of the spike's shape: it writes into the textarea and the
    // existing บันทึก path persists it. A write here would be a second writer
    // to one row — the drift class this repo pays for most.
    expect(SRC, 'the visual editor writes to the database directly')
      .not.toMatch(/dbRest|supabase/);
  });

  it('the caller puts the result in the textarea the save path already reads', () => {
    expect(ADMIN).toMatch(/data-dpa-field="html"/);
    const handler = ADMIN.slice(ADMIN.indexOf("data-dpa-visual]"));
    expect(handler.slice(0, 900)).toMatch(/ta\.value = html/);
  });

  it('never autosaves into localStorage', () => {
    // GrapesJS defaults to a localStorage StorageManager, which would make the
    // editor's idea of the page outlive and silently override the database.
    expect(SRC).toMatch(/storageManager:\s*false/);
  });

  it('opens on the PHONE width, because that is most of the traffic', () => {
    // GrapesJS opens on the first device in the list, so the order is the rule.
    const dm = SRC.slice(SRC.indexOf('deviceManager'));
    const first = dm.slice(0, dm.indexOf(']'));
    expect(first.indexOf("id: 'mobile'"), 'the editor no longer opens at phone width')
      .toBeLessThan(first.indexOf("id: 'desktop'"));
  });
});


describe('a link must open in a new tab, or it hijacks the ฝ่าย page', () => {
  // The frame is sandboxed WITHOUT allow-same-origin and WITHOUT
  // allow-top-navigation. A bare <a href> therefore navigates the FRAME — the
  // linked site loads inside the little embedded box, at the block's height,
  // with no way back. This shipped in the spike's ปุ่มลิงก์ block and would only
  // ever have been noticed by someone clicking a live ฝ่าย button.

  it('every link BLOCK ships target=_blank and rel=noopener', () => {
    const withLinks = BLOCKS
      .filter((b) => typeof b.content === 'string' && /<a\b/i.test(b.content));
    expect(withLinks.length, 'control: no block has a link at all').toBeGreaterThan(0);
    for (const b of withLinks) {
      for (const tag of b.content.match(/<a\b[^>]*>/gi)) {
        expect(tag, `block ${b.id} has a link that would navigate the frame`)
          .toMatch(/target="_blank"/);
        expect(tag, `block ${b.id} link has no rel=noopener`).toMatch(/rel="noopener"/);
      }
    }
  });

  it('forceExternalLinks repairs a bare link the author pasted', () => {
    const out = forceExternalLinks('<a href="https://kku.ac.th">ไป</a>');
    expect(out).toMatch(/target="_blank"/);
    expect(out).toMatch(/rel="noopener"/);
  });

  it('rewrites a target the author chose — _self would break in the sandbox', () => {
    const out = forceExternalLinks('<a href="x" target="_self">ไป</a>');
    expect(out).toMatch(/target="_blank"/);
    expect(out).not.toMatch(/_self/);
  });

  it('leaves a correct link alone rather than doubling its attributes', () => {
    const good = '<a href="x" target="_blank" rel="noopener">ไป</a>';
    expect(forceExternalLinks(good)).toBe(good);
  });

  it('touches nothing that is not a link (control)', () => {
    const html = '<p>ไม่มีลิงก์</p><img src="a.png">';
    expect(forceExternalLinks(html)).toBe(html);
  });

  it('runs on SAVE, not just in the block definitions', () => {
    // A block set that is correct today does not help when the author pastes
    // their own markup. The guard has to be on the path out.
    const SRC2 = readFileSync(join(ROOT, 'src', 'js', 'dept-visual-editor.js'), 'utf8');
    expect(SRC2, 'the save path does not normalise links')
      .toMatch(/close\(wrapDocument\(forceExternalLinks\(/);
  });
});

describe('the URL field is findable — the first real test could not find it', () => {
  // Reported by the owner, in full: "i've tested it, i don't even know how to
  // attach link to the button". The trait EXISTED; it lived behind a gear icon.
  // A feature that cannot be found is not different from a missing one.
  const SRC2 = readFileSync(join(ROOT, 'src', 'js', 'dept-visual-editor.js'), 'utf8');

  it('opens the settings panel when something with traits is selected', () => {
    expect(SRC2).toMatch(/component:selected/);
    expect(SRC2, 'nothing switches to the trait panel, so the link field stays hidden')
      .toMatch(/showPanel\(['"]open-tm['"]\)/);
  });

  it('labels the link field in Thai, not "href"', () => {
    expect(SRC2).toMatch(/name: 'href', label: 'ลิงก์'/);
  });

  it('does NOT offer target as a choice', () => {
    // Any value but _blank loads the linked site inside the ฝ่าย page's box.
    const linkType = SRC2.slice(SRC2.indexOf("addType('link'"), SRC2.indexOf("addType('image'"));
    expect(linkType, "target is offered as a trait — _self would break in the sandbox")
      .not.toMatch(/name: 'target'/);
  });

  it('the toolbar hint says where the link field appears', () => {
    expect(SRC2).toMatch(/ลิงก์.*ทางขวา|ทางขวา/);
  });
});

describe('the block set is big enough to build a real page', () => {
  it('covers the things a ฝ่าย page actually needs', () => {
    const ids = BLOCKS.map((b) => b.id);
    for (const need of ['samo-list', 'samo-table', 'samo-faq', 'samo-callout',
      'samo-image-text', 'samo-contact', 'samo-steps']) {
      expect(ids, `no ${need} block`).toContain(need);
    }
    expect(BLOCKS.length).toBeGreaterThanOrEqual(20);
  });

  it('every block is filed under a real category', () => {
    const cats = Object.values(CAT);
    for (const b of BLOCKS) {
      expect(cats, `block ${b.id} has category ${b.category}`).toContain(b.category);
    }
  });

  it('every block has a unique id', () => {
    const ids = BLOCKS.map((b) => b.id);
    expect(new Set(ids).size, 'two blocks share an id — one silently replaces the other')
      .toBe(ids.length);
  });

  it('the FAQ block opens without javascript', () => {
    // Bootstrap's accordion JS does not exist in the sandboxed frame; <details>
    // is native and needs nothing.
    const faq = BLOCKS.find((b) => b.id === 'samo-faq');
    expect(faq.content).toMatch(/<details/);
    expect(faq.content).not.toMatch(/data-bs-|accordion/);
  });

  it('the table cannot push the ฝ่าย page sideways', () => {
    const table = BLOCKS.find((b) => b.id === 'samo-table');
    expect(table.content, 'a wide table with no scroll container overflows the page')
      .toMatch(/overflow-x:\s*auto/);
  });
});


describe('a block fetches NOTHING from the network', () => {
  // Caught by screenshotting, not by reading: the image blocks pointed at
  // placehold.co. That is a third-party request from a student-facing page, it
  // renders as a broken-image icon wherever the host is slow or blocked, and a
  // broken image collapses to ~20px — so the "does it stack on a phone" check
  // was silently measuring nothing.
  const srcs = BLOCKS
    .filter((b) => typeof b.content === 'string')
    .flatMap((b) => [...b.content.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/gi)]
      .map((m) => ({ id: b.id, url: m[1] })));

  it('has images to check (control)', () => {
    expect(srcs.some((x) => x.url.startsWith('data:image/svg+xml'))).toBe(true);
  });

  it('no src or href reaches out over http(s)', () => {
    // NOTE the xmlns inside the SVG data URI is http://www.w3.org/2000/svg —
    // an XML namespace, never fetched. Matching the whole block body would
    // flag it, which is why this reads the ATTRIBUTES.
    const external = srcs.filter((x) => /^https?:/i.test(x.url));
    expect(external, 'a block loads something from another host').toEqual([]);
  });

  it('no CSS url() reaches out either', () => {
    const html = BLOCKS.map((b) => (typeof b.content === 'string' ? b.content : '')).join('');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
  });
});


describe('an image in a flex row can actually shrink', () => {
  it('every flex image carries min-width:0', () => {
    // In flex layout an image's `min-width: auto` resolves to its INTRINSIC
    // width, so a 400px-wide placeholder refuses to go below 400px however
    // small the flex-basis says. Three gallery images then need 1220px, two fit
    // and the third wraps alone and stretches to full width. Found at 900px in
    // a browser; the markup reads correctly without it.
    // ⚠️ NOT `<img[^>]*style="..."`. The src is an inline SVG data URI and it
    // CONTAINS `>`, so that pattern stops inside the image and matches nothing.
    // The control below is what said so — it reported 0 images, not a pass.
    const imgs = BLOCKS
      .filter((b) => typeof b.content === 'string')
      .flatMap((b) => b.content.split('<img').slice(1)
        .map((frag) => ({ id: b.id, style: (frag.match(/style="([^"]*)"/) || [])[1] || '' })))
      .filter((x) => /flex:\s*1 1/.test(x.style));
    expect(imgs.length, 'control: no flex image found').toBeGreaterThan(0);
    for (const x of imgs) {
      expect(x.style, `${x.id} has a flex image that cannot shrink`).toMatch(/min-width:\s*0/);
    }
  });
});
