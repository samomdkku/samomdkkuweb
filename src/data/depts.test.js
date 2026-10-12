// ============================================================
// depts.test.js — DEPT_DEFS carries all 12 ฝ่าย, every colour it names
// exists, and the grant migration (0213) agrees with it exactly.
//
// WHY THIS EXISTS. Before 0213, DEPT_DEFS carried 6 of the 12 top-level ฝ่าย
// ทีม SAMO's own tree has — the other six existed as disabled "เร็วๆ นี้"
// placeholder cards nobody could open, and none of their people could be
// granted a page to edit because the grant list (DEPT_PAGES / DEPT_OPTIONS) is
// DERIVED from this same object. One omission here meant a dept had no page,
// no grant, and no complaint path except "ask IT".
//
// The differential test at the bottom reads 0213's own VALUES list rather than
// retyping it — a guard written from a second copy of the same list only
// proves the two copies agree (`.claude/rules/mistakes.md` class 6/7).
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEPT_DEFS, DEPT_KEYS, DEPT_OPTIONS } from './depts.js';
import { DEPT_PAGES } from '../js/team-vocab.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');

const THE_12_TITLES = [
  'สำนักนายกฯ',
  'ฝ่ายบริหารองค์กร',
  'ฝ่ายดิจิทัลและสื่อสารองค์กร',
  'ฝ่ายกิจการภายใน',
  'ฝ่ายกิจการภายนอก',
  'ฝ่ายกิจการมหาวิทยาลัย',
  'ฝ่ายวิชาการ',
  'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
  'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
  'ฝ่ายรังสีเทคนิค',
  'ฝ่ายเวชนิทัศน์',
  'ฝ่าย รพ. ร่วมผลิต',
];

describe('DEPT_DEFS carries every ฝ่าย the tree has', () => {
  it('has all 12 top-level titles, each exactly once', () => {
    const titles = Object.values(DEPT_DEFS).map((d) => d.title);
    expect(new Set(titles).size, 'a duplicate title in DEPT_DEFS').toBe(titles.length);
    const missing = THE_12_TITLES.filter((t) => !titles.includes(t));
    expect(missing, `DEPT_DEFS is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key has a colour token that actually exists in base.css', () => {
    const base = read('src/css/base.css');
    const missing = Object.entries(DEPT_DEFS)
      .filter(([, d]) => !new RegExp(`${d.colorVar}\\s*:`).test(base))
      .map(([k, d]) => `${k} (${d.colorVar})`);
    expect(missing, `no custom property in base.css for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the control — a colour token that does not exist would be caught', () => {
    const base = read('src/css/base.css');
    expect(new RegExp('--dept-nosuchdept\\s*:').test(base)).toBe(false);
  });

  it('สำนักนายกฯ and ฝ่าย รพ. ร่วมผลิต get their OWN colour, distinct from the other ten', () => {
    // Both were asked to be distinguishable from the ten that already existed
    // — asserted on the resolved hex values themselves, not just "some token
    // exists", or two depts could still share one colour by accident.
    const base = read('src/css/base.css');
    const hexOf = (varName) => {
      const m = base.match(new RegExp(`${varName}:\\s*(#[0-9A-Fa-f]{3,8})`));
      return m ? m[1].toLowerCase() : null;
    };
    const allVars = Object.values(DEPT_DEFS).map((d) => d.colorVar);
    const hexes = allVars.map(hexOf);
    expect(hexes.every(Boolean), `could not resolve a hex for every dept colorVar: ${allVars.join(', ')}`).toBe(true);
    expect(new Set(hexes).size, 'two ฝ่าย share the exact same colour hex').toBe(hexes.length);
  });

  it('DEPT_PAGES (the grant picker) offers all 12, derived — not a second list', () => {
    expect(DEPT_PAGES).toEqual(DEPT_OPTIONS);
    expect(DEPT_KEYS.length).toBe(12);
    const labels = DEPT_PAGES.map((d) => d.label);
    const missing = THE_12_TITLES.filter((t) => !labels.includes(t));
    expect(missing, `DEPT_PAGES cannot grant: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('migration 0213 agrees with DEPT_DEFS exactly', () => {
  const sql = read('supabase/migrations/0213_dept_pages_for_every_dept.sql');
  const pairs = [...sql.matchAll(/\(\s*'([^']+)',\s*'([a-z]+)'\s*\)/g)]
    .map(([, name, key]) => ({ name, key }));

  it('the migration still carries a VALUES list this test can read', () => {
    // The instrument, checked before it is trusted — a rewritten migration
    // would otherwise leave every assertion below comparing against nothing
    // and passing.
    expect(pairs.length, 'no (name, key) pairs parsed out of 0213').toBe(12);
  });

  it('only fills a NULL dept_page — never overwrites one set by hand', () => {
    expect(sql).toMatch(/and\s+t\.dept_page\s+is\s+null/);
  });

  it('every pair names a REAL DEPT_DEFS key, with the matching title', () => {
    const mismatches = pairs.filter((p) => DEPT_DEFS[p.key]?.title !== p.name);
    expect(mismatches, `migration/DEPT_DEFS disagree on: ${JSON.stringify(mismatches)}`).toEqual([]);
  });

  it('covers every DEPT_DEFS key — nothing added to the app with no grant path', () => {
    const migrationKeys = new Set(pairs.map((p) => p.key));
    const missing = DEPT_KEYS.filter((k) => !migrationKeys.has(k));
    expect(missing, `DEPT_DEFS keys with no 0213 grant row: ${missing.join(', ')}`).toEqual([]);
  });
});
