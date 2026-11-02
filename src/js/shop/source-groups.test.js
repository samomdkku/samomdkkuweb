// SAMO Shop's แหล่งที่มา filter (owner, 2026-11-02) and the Students-initiative
// link products (0274).
//
// Two halves of one rule live apart: the JS list of sources and the database's
// `shop_products_source_check`. A source the page offers that the database
// refuses is a save that fails for the admin; one the database allows that the
// page does not know renders a blank label. Read BOTH and compare — the newest
// migration that writes the check is the database half.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHOP_SOURCES, SHOP_SOURCE_GROUPS, matchesSourceFilter, isLinkProduct, pickableSources,
} from './data.js';

const md = { source: 'md' };
const mdi = { source: 'mdi' };
const rt = { source: 'rt' };
const link = { source: 'student', external_url: 'https://forms.gle/x' };
const old = { source: 'sittikao' };

describe('the แหล่งที่มา filter', () => {
  it('ทั้งหมด shows everything', () => {
    for (const p of [md, mdi, rt, link, old]) expect(matchesSourceFilter(p, 'all')).toBe(true);
  });
  it('SAMO official is MD · MDI · RT — and nothing else', () => {
    expect([md, mdi, rt].every((p) => matchesSourceFilter(p, 'official'))).toBe(true);
    expect(matchesSourceFilter(link, 'official')).toBe(false);
    expect(matchesSourceFilter(old, 'official')).toBe(false);
  });
  it('Students initiative is the link products only', () => {
    expect(matchesSourceFilter(link, 'student')).toBe(true);
    expect([md, mdi, rt, old].some((p) => matchesSourceFilter(p, 'student'))).toBe(false);
  });
  it('one source narrows to itself', () => {
    expect(matchesSourceFilter(mdi, 'mdi')).toBe(true);
    expect(matchesSourceFilter(md, 'mdi')).toBe(false);
  });
  it('the groups, in the owner\'s order, and สมาคมสิทธิ์เก่า is in neither', () => {
    expect(SHOP_SOURCE_GROUPS.map((g) => [g.label, g.sources])).toEqual([
      ['SAMO official', ['md', 'mdi', 'rt']],
      ['Students initiative', ['student']],
    ]);
    expect(SHOP_SOURCE_GROUPS.some((g) => g.sources.includes('sittikao'))).toBe(false);
  });
  it('every grouped source has a label (no blank chip)', () => {
    for (const g of SHOP_SOURCE_GROUPS) for (const id of g.sources) {
      expect(SHOP_SOURCES.find((s) => s.id === id)?.label, id).toBeTruthy();
    }
  });
});

describe('isLinkProduct', () => {
  it('is the student source WITH a link', () => {
    expect(isLinkProduct(link)).toBe(true);
    expect(isLinkProduct({ source: 'student' })).toBe(false);
    expect(isLinkProduct({ source: 'md', external_url: 'https://x' })).toBe(false);
    expect(isLinkProduct(null)).toBe(false);
  });
});

describe('the admin source picker', () => {
  it('offers Students initiative and not the retired สมาคมสิทธิ์เก่า', () => {
    const ids = pickableSources('md').map((s) => s.id);
    expect(ids).toEqual(['md', 'rt', 'mdi', 'student']);
  });
  it('keeps a retired source on a product that already has it, so opening it changes nothing', () => {
    expect(pickableSources('sittikao').map((s) => s.id)).toContain('sittikao');
  });
});

describe('the JS source list matches the database check', () => {
  it('same set of ids as the newest shop_products_source_check', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let db = null;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const m = [...sql.matchAll(/add constraint shop_products_source_check\s+check\s*\(([\s\S]*?)\);/gi)].pop();
      if (m) db = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
    expect(db, 'no migration writes shop_products_source_check').not.toBeNull();
    const js = SHOP_SOURCES.filter((s) => s.id !== 'all').map((s) => s.id);
    expect([...js].sort()).toEqual([...db].sort());
  });
});
