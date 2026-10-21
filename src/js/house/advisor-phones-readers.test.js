// ============================================================
// advisor-phones-readers.test.js — an อาจารย์'s phone has exactly ONE reader.
//
// `advisor_phones` (0243) is house-admin only, and the database proof
// (tools/house0243-advisor-phones.sql) holds the policy and the student path.
// What the database cannot see is a SECOND frontend reader: the public bundle,
// Passport, the VM's server code or Apps Script naming the table. RLS would
// still refuse a student, but authorization is per-path (mistakes.md class 4),
// and the cheapest moment to ask "should this reader exist?" is before it
// ships. A new reader is a decision for the owner — add it here only then.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const DIRS = ['src', 'passport', 'server', 'appscript', 'functions'];
const SKIP = new Set(['node_modules', 'dist', '.vitepress']);
const SOURCE = /\.(js|mjs|cjs|html|gs|ts|vue)$/;

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (SOURCE.test(entry) && !entry.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const ALLOWED = [
  'src/js/house/advisor-import.js', // advisorPhone(): reads the field api.js embedded
  'src/js/house/api.js',            // the one fetch + the one write
];

describe('advisor_phones readers', () => {
  const all = DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => files(join(ROOT, d)));

  it('the sweep sees the app (control: an empty sweep would pass anything)', () => {
    expect(all.map((p) => relative(ROOT, p))).toContain('src/js/house/api.js');
    expect(all.length).toBeGreaterThan(100);
  });

  it('only the ระบบบ้าน admin API names the table', () => {
    const readers = all.filter((p) => readFileSync(p, 'utf8').includes('advisor_phones'))
      .map((p) => relative(ROOT, p)).sort();
    expect(readers).toEqual(ALLOWED);
  });
});
