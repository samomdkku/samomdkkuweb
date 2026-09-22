// Every reader of a product's pictures, classified (docs/SHOP-GALLERY.md §8).
//
// 0203 gave a product several pictures (`images`) and kept `image_url` as the
// COVER, derived by a trigger. A migration carries columns, not readers
// (mistakes class 6): a new reader of `image_url` silently shows only the cover
// — and one deciding whether a picture is "in use" silently deletes a gallery
// picture another product still shows. So the count of references per module
// is a REGISTRY: a new one is red until someone decides what it should read.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';

const REGISTRY = {
  // data.js — productImages()/pictureFor(): the ONE place `images` is read, and
  // its fallback to the legacy cover.
  'data.js':     { image_url: 2, images: 2 },
  // products.js — the card, the announcement art and banners: COVERS on purpose.
  // The popup reads pictures through gallery.js → productImages().
  'products.js': { image_url: 10, images: 0 },
  // admin.js — batch/banner/QR images (their own column), product table and
  // stock thumbnails (cover), and the save payload (dropped before the write).
  // The in-use check reads productImages() — asserted below, not assumed.
  'admin.js':    { image_url: 27, images: 1 },
};

const dir = 'src/js/shop';
const files = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
const src = Object.fromEntries(files.map((f) => [f, stripComments(readFileSync(`${dir}/${f}`, 'utf8'))]));
const count = (s, re) => (s.match(re) || []).length;

describe('readers of a product\'s pictures', () => {
  it('has a control — the sweep sees the files', () => {
    expect(files).toContain('data.js');
    expect(files).toContain('gallery.js');
  });

  it('knows every module that reads image_url or images, at its count', () => {
    const seen = {};
    for (const [f, s] of Object.entries(src)) {
      const a = count(s, /\bimage_url\b/g);
      const b = count(s, /\.images\b/g);
      if (a || b) seen[f] = { image_url: a, images: b };
    }
    expect(seen).toEqual(REGISTRY);
  });

  it('the picture in-use check reads every picture of every product', () => {
    const s = src['admin.js'];
    const body = s.slice(s.indexOf('async function trashImageIfUnused'));
    expect(body.slice(0, 1500)).toMatch(/productImages\(/);
  });

  it('cart, checkout and my-orders thumbnails go through the shared helper', () => {
    for (const f of ['cart.js', 'checkout.js', 'orders.js']) {
      expect(src[f], f).toMatch(/\bthumbStyle\(p, it\.color\)/);
    }
  });
});
