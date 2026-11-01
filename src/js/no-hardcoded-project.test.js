// ============================================================
// no-hardcoded-project.test.js — shipped code names NO Supabase project.
//
// The address and visitor key come from the BUILD (VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY): production's on the VM, samo-dev's on a laptop or a
// preview. The Passport app carried production's as a FALLBACK until
// 2026-11-01, so a build made without its env (a contributor's checkout, a
// preview whose env was not mapped, the 2026-09 `envDir` mistake) read and
// wrote real student data while looking like a test site.
//
// The PROPERTY, not a list of files: no browser-side source under src/ or
// passport/ holds a real project URL or publishable key. Tests are exempt —
// they use made-up refs on purpose.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIRS = ['src', 'passport'];
const SKIP = new Set(['node_modules', 'dist', '.vite']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p);
  }
  return out;
}

// A real project ref is 20 lowercase letters/digits; a publishable key starts
// sb_publishable_. A legacy anon JWT starts eyJ and names role "anon".
const PROJECT_URL = /https:\/\/[a-z0-9]{20}\.supabase\.co/;
const PUBLISHABLE = /sb_publishable_[A-Za-z0-9_-]{10,}/;

export function findHardcodedProjects(files, read = (f) => readFileSync(f, 'utf8')) {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const re of [PROJECT_URL, PUBLISHABLE]) {
      const m = text.match(re);
      if (m) hits.push(`${relative(ROOT, f)}: ${m[0].slice(0, 40)}`);
    }
  }
  return hits;
}

describe('shipped code names no Supabase project', () => {
  const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

  it('the sweep actually covers the two apps (control)', () => {
    const rel = files.map((f) => relative(ROOT, f));
    expect(rel).toContain('src/js/db.js');
    expect(rel).toContain('passport/js/app.js');
  });

  it('the detector sees the shape it exists to catch (control)', () => {
    const planted = 'const U = x || "https://abcdefghijklmnopqrst.supabase.co"; const K = y || "sb_publishable_-pPHqzUCF-0jOG";';
    expect(findHardcodedProjects(['planted.js'], () => planted)).toHaveLength(2);
  });

  it('no file under src/ or passport/ hardcodes a project URL or publishable key', () => {
    expect(findHardcodedProjects(files)).toEqual([]);
  });
});
