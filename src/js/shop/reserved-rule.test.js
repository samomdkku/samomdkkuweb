// The "reserved stock" rule lives in three SQL functions: the one that REFUSES
// an order (place_shop_order) and the two the storefront reads to show what is
// LEFT (shop_reserved_matrix, shop_reserved_matrix_all). 0038 taught all three
// to ignore preorder items; 0040 rebuilt the display pair from an older copy
// and lost it, so the storefront could call a size sold out that the server
// would sell (0202). Nothing failed — only a number was wrong.
//
// A migration history is the source of truth for a fresh database, so assert
// the LATEST definition of each, not the one that first got it right.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { placeOrderErrorMessage } from './api.js';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

/** Body of the last `create or replace function public.<name>(` in the history. */
function latestDefinition(name) {
  let last = null;
  const head = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  for (const f of files) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    const m = sql.match(head);
    if (!m) continue;
    // A body runs from its opening $tag$ to the matching closing tag.
    const rest = sql.slice(m.index);
    const tag = rest.match(/\$[a-z_]*\$/i)?.[0];
    const open = rest.indexOf(tag);
    const close = rest.indexOf(tag, open + tag.length);
    last = { file: f, body: rest.slice(open, close) };
  }
  return last;
}

const FUNCTIONS = ['place_shop_order', 'shop_reserved_matrix', 'shop_reserved_matrix_all'];
const PREORDER_FILTER = /coalesce\(\s*oi\.is_preorder\s*,\s*false\s*\)\s*=\s*false/i;
const STATUSES = /o\.status\s+in\s*\(([^)]*)\)/i;

describe('reserved stock: one rule in three functions', () => {
  const defs = Object.fromEntries(FUNCTIONS.map((n) => [n, latestDefinition(n)]));

  it('finds a definition of each (the control)', () => {
    for (const n of FUNCTIONS) expect(defs[n], n).not.toBeNull();
  });

  it('every latest definition leaves preorder items out of reserved stock', () => {
    const missing = FUNCTIONS.filter((n) => !PREORDER_FILTER.test(defs[n].body))
      .map((n) => `${n} (${defs[n].file})`);
    expect(missing).toEqual([]);
  });

  it('the display pair counts the same order statuses as each other', () => {
    const set = (n) => defs[n].body.match(STATUSES)[1].replace(/\s+/g, '');
    expect(set('shop_reserved_matrix')).toBe(set('shop_reserved_matrix_all'));
  });
});

describe('every refusal place_shop_order can raise reaches the buyer in Thai', () => {
  // The codes come from the SQL, not from the translator — a list copied from
  // the translator would agree with itself (mistakes.md class 7). A new
  // `raise exception 'X'` without a message is red here.
  const body = latestDefinition('place_shop_order').body;
  const codes = [...new Set([...body.matchAll(/raise\s+exception\s+'([A-Z_]+)/g)].map((m) => m[1]))];
  const FALLBACK = placeOrderErrorMessage('');

  it('finds the refusals (the control)', () => {
    expect(codes).toEqual(expect.arrayContaining(['OUT_OF_STOCK', 'SIZE_UNAVAILABLE', 'COLOR_UNAVAILABLE']));
  });

  it('gives each a message of its own, except the one a person cannot act on', () => {
    // ID_GENERATION_FAILED is "try again" by design: the fallback says exactly that.
    const generic = codes.filter((c) => c !== 'ID_GENERATION_FAILED'
      && placeOrderErrorMessage(`${c}: x`).startsWith(FALLBACK));
    expect(generic).toEqual([]);
  });

  it('never shows the raw code alone or an object', () => {
    for (const m of [...codes.map((c) => `${c}: p-1`), '', 'invalid input syntax for type integer']) {
      const out = placeOrderErrorMessage(m);
      expect(out).toMatch(/[\u0E00-\u0E7F]/); // Thai
      expect(out).not.toMatch(/\[object /);
    }
  });
});
