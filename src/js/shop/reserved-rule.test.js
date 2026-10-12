// The "reserved stock" rule — what is TAKEN from a product's size × colour
// grid — decides both what the storefront shows as LEFT and what the server
// will SELL. It used to live in three SQL functions (place_shop_order inline,
// shop_reserved_matrix, shop_reserved_matrix_all); 0040 rebuilt two of them
// from an older copy and lost 0038's preorder filter, so the storefront could
// call a size sold out that the server would sell (0202). Nothing failed —
// only a number was wrong.
//
// 0209 gave the rule ONE home, shop_reserved_matrix, and taught it preorder:
// a preorder product's grid is its run size, so every preorder item counts
// until its order is cancelled. The other two ASK it. This file asserts that
// shape — a copy creeping back is how the drift starts again.
//
// A migration history is the source of truth for a fresh database, so assert
// the LATEST definition of each, not the one that first got it right.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { placeOrderErrorMessage, isAmbiguousFailure } from './api.js';

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
const ASKS_THE_HOME = /public\.shop_reserved_matrix\s*\(/i;
const OWN_RULE = /\boi\.(is_preorder|item_status)\b|o\.status\s+in\s*\(/i;

describe('reserved stock: one rule, one home', () => {
  const defs = Object.fromEntries(FUNCTIONS.map((n) => [n, latestDefinition(n)]));
  const home = () => defs.shop_reserved_matrix.body;

  it('finds a definition of each (the control)', () => {
    for (const n of FUNCTIONS) expect(defs[n], n).not.toBeNull();
    // the OWN_RULE pattern sees a rule where one is written
    expect(OWN_RULE.test(home())).toBe(true);
  });

  it('the guard and the catalogue copy ASK the home, and carry no rule of their own', () => {
    for (const n of ['place_shop_order', 'shop_reserved_matrix_all']) {
      expect(ASKS_THE_HOME.test(defs[n].body), `${n} (${defs[n].file}) asks shop_reserved_matrix`).toBe(true);
      expect(OWN_RULE.test(defs[n].body), `${n} (${defs[n].file}) has its own copy of the rule`).toBe(false);
    }
  });

  it('IN STOCK: preorder items are not stock, and a delivered item stops counting', () => {
    expect(home()).toMatch(/coalesce\(\s*oi\.is_preorder\s*,\s*false\s*\)\s*=\s*false/i);
    expect(home()).toMatch(/coalesce\(\s*oi\.item_status\s*,\s*'paid'\s*\)\s*<>\s*'done'/i);
  });

  it('PREORDER: preorder items count until the order is cancelled — delivered included', () => {
    const branch = home().match(/when\s+coalesce\(\s*p\.is_presale[\s\S]*?else/i)?.[0] || '';
    expect(branch).toMatch(/coalesce\(\s*oi\.is_preorder\s*,\s*false\s*\)\s*=\s*true/i);
    expect(branch).toMatch(/o\.status\s+is\s+distinct\s+from\s+'cancel'/i);
    expect(branch, 'a delivered preorder must keep its slot').not.toMatch(/item_status/i);
  });

  it('the guard checks the grid for preorder products too', () => {
    // Before 0209 the stock check sat in the ELSE of `if v_item_is_preorder`.
    expect(defs.place_shop_order.body).not.toMatch(/if\s+v_item_is_preorder\s+then[^;]*;\s*else/i);
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

describe('which failed writes are UNSURE (the order or slip may have landed)', () => {
  it('no answer, or a gateway 5xx after a possible commit — never "it failed"', () => {
    expect(isAmbiguousFailure({ message: 'signal is aborted without reason' })).toBe(true);
    expect(isAmbiguousFailure({ status: 502 })).toBe(true);
    expect(isAmbiguousFailure({ status: 504 })).toBe(true);
  });
  it('a refusal the server stated is an answer', () => {
    expect(isAmbiguousFailure({ status: 400, message: 'OUT_OF_STOCK' })).toBe(false);
    expect(isAmbiguousFailure({ status: 403 })).toBe(false);
  });
});
