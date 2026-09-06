// ==============================================
// A COMMAND PRINTED IN A DOC MUST BE THE COMMAND THAT WORKS.
//
// ⛔ FOUND 2026-09-06 when the owner asked me to CHECK the docs rather than
// trust them. `README.md` told people to run:
//
//     npm run migrate:status --dev
//
// npm swallows `--dev` as its own flag and never passes it on, so that command
// answers about **PRODUCTION** while the reader believes they asked about
// samo-dev — measured: `[PRODUCTION] PENDING: 0` versus `[samo-dev] PENDING: 3`
// for the same line with `--` added. A wrong answer wearing the right question,
// which is the shape this repo pays for most.
//
// The correct form is `npm run <script> -- --flag`. This sweep is cheap and the
// failure it prevents is silent, so it is worth having for ever.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.vitepress', 'package', 'state-archive']);

function markdownFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (name.endsWith('.md')) out.push(relative(ROOT, full));
  }
  return out;
}

const FILES = markdownFiles();

/** `npm run x --flag` — npm eats the flag. `npm run x -- --flag` is correct. */
const BAD = /npm run [a-z][a-z0-9:-]*\s+--[a-z]/g;

describe('npm commands printed in documentation', () => {
  it('control: the sweep actually reads this repo\'s markdown', () => {
    expect(FILES.length, 'found no markdown files at all').toBeGreaterThan(20);
    expect(FILES.join(' ')).toContain('README.md');
    // And it can SEE the pattern it hunts — proved on a synthetic line, so an
    // empty result means "clean", not "the regex is broken".
    expect('npm run migrate:status --dev'.match(BAD)).not.toBeNull();
    expect('npm run migrate:status -- --dev'.match(BAD)).toBeNull();
  });

  it('always pass flags after `--`, or npm silently drops them', () => {
    const offenders = [];
    for (const f of FILES) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      for (const line of text.split('\n')) {
        for (const hit of line.match(BAD) || []) offenders.push(`${f}: ${hit.trim()}`);
      }
    }
    expect([...new Set(offenders)], 'npm swallows a flag written this way and '
      + 'never passes it to the script. `npm run migrate:status --dev` answered '
      + 'about PRODUCTION while reading as a question about samo-dev. Write '
      + '`npm run <script> -- --flag`:\n' + [...new Set(offenders)].join('\n'))
      .toEqual([]);
  });
});

describe('npm scripts named in documentation exist', () => {
  // The other half: a doc naming a script that was renamed or never added.
  const scripts = new Set(Object.keys(
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts || {},
  ));

  it('control: package.json has scripts and the docs name some of them', () => {
    expect(scripts.size).toBeGreaterThan(5);
    expect(scripts.has('dev')).toBe(true);
    // The sweep must be able to FAIL: a name that is not a script must be
    // caught, or "no missing scripts" would mean nothing.
    expect(scripts.has('definitely-not-a-real-script')).toBe(false);
  });

  it('every `npm run <name>` in the getting-started pages is a real script', () => {
    // Scoped to the pages a newcomer follows literally — elsewhere a doc may
    // discuss a script from another repo or a proposed one.
    const pages = FILES.filter((f) => f.startsWith('docs/start/') || f === 'README.md');
    expect(pages.length, 'the getting-started sweep found no pages').toBeGreaterThan(3);
    const missing = [];
    for (const f of pages) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      // `npm run migrate:*` is a legitimate wildcard in prose, not a script
      // name — exclude it rather than rewriting the sentence around the guard.
      for (const m of text.matchAll(/npm run ([a-z][a-z0-9:-]*)(\*?)/g)) {
        if (m[2] === '*') continue;
        if (!scripts.has(m[1])) missing.push(`${f}: npm run ${m[1]}`);
      }
    }
    expect([...new Set(missing)], 'a getting-started page tells someone to run a '
      + 'script that does not exist:\n' + [...new Set(missing)].join('\n')).toEqual([]);
  });
});
