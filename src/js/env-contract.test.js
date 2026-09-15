// ============================================================
// env-contract.test.js — NO BUILD-TIME ENV READ MAY FAIL SILENTLY.
//
// THE CLASS THIS EXISTS FOR. On 2026-09-15 the passport admin's ⬆️ Upload button
// was reported missing. It had been gone for eleven days, and every existing
// signal said the app was healthy: `npm test` passed, `npm run build` passed,
// the HTML was byte-correct, the string "⬆️ Upload" was still in the shipped
// bundle. `passport/js/upload.js` read its Drive endpoint from
// `import.meta.env?.VITE_GAS_UPLOAD_URL` with `|| ''` behind it, the value did
// not survive a repo merge, and `wireUpload()` returned before painting
// anything. The `|| ''` is the whole bug: it turned "this build has no endpoint"
// into a perfectly ordinary falsy string that three call sites then treated as
// "feature off".
//
// WHY A GENERAL GUARD AND NOT ANOTHER ONE-OFF. A test pinned to
// VITE_GAS_UPLOAD_URL would have caught that one variable. The defect is the
// SHAPE: `import.meta.env.X` is compiled away at build time, so an absent value
// is not an error, not a crash and not a log — it is a literal that folds into
// the bundle and silently changes what the app does. Every var added from here
// on has the same shape, and the next one will be added by someone who has never
// read this story. So the property is asserted over the reads themselves,
// DISCOVERED BY SCANNING SOURCE — a new variable cannot join the codebase
// without answering "and what happens when this is absent?".
//
// THE PROPERTY. For every `VITE_*` name read in shipped code, at least one of:
//   (a) a checked-in FALLBACK at a read site — `|| 'literal'` or `|| IDENT`;
//   (b) an ANNOUNCED absence — a branch testing it that throws, console.errors
//       or console.warns, so a human or a log can see it;
//   (c) the name is in TOLERATED_SILENT below, WITH A WRITTEN REASON.
//
// (c) is deliberately awkward to use. It is not an escape hatch for "I could not
// be bothered" — it is for the one genuine case where ABSENCE IS THE INTENDED
// PRODUCTION MEANING, and it must say so in prose that the next reader can
// disagree with.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

/**
 * Names whose ABSENCE IS A SUPPORTED, INTENDED STATE — each with the reason,
 * because a list of bare names is exactly the thing that rots into nonsense.
 */
const TOLERATED_SILENT = {
  VITE_ENV_NAME: 'Unset MEANS production. It exists to make a PREVIEW say it is '
    + 'not the live site (src/js/env-ribbon.js), so the live site is precisely '
    + 'the build that does not set it. A fallback would have to invent a value '
    + 'for the majority case, and announcing its absence would shout on every '
    + 'production load — the healthy-case warning this repo has already shipped '
    + 'once. Its readers all treat null as "this is production", which is right.',
};

/**
 * passport/ reads that CANNOT have a checked-in fallback, with the reason.
 * Keyed `file::NAME` so an exemption cannot silently spread to another module.
 *
 * ⛔ Adding an entry here is a decision, not a formality. The default answer for
 * passport/ is a checked-in default, because that half has no `.env*` of its own
 * and nothing routes anyone to set one. Only put a name here when a value
 * genuinely must not be in git.
 */
const PASSPORT_NO_FALLBACK = {
  'passport/js/admin-scope.js::VITE_PASSPORT_ADMIN_EMAIL':
    'A credential. It signs into the shared account behind the temporary '
    + 'admin/1234 door, so a checked-in default would be a password in git — and '
    + 'this repo is PUBLIC. Absence is ANNOUNCED instead: LEGACY_LOGIN_CONFIGURED '
    + 'goes false, the box is not drawn (admin-page.js), and legacyLogin() throws '
    + 'rather than failing like a typo. ⚠️ It has in fact been absent in '
    + 'production since the 2026-09-04 merge — by accident, not decision; see '
    + 'docs/state/HANDOFF.md before "fixing" it, because re-opening a '
    + 'shared-password full-access door is the owner\'s call.',
  'passport/js/admin-scope.js::VITE_PASSPORT_ADMIN_PASSWORD':
    'The other half of the same credential — same reasoning, same story. Kept as '
    + 'a separate entry on purpose: an exemption that covered "the admin vars" as '
    + 'a group would silently cover the third one somebody adds later.',
};

/** Vite builtins — not app config, always defined by the bundler. */
const BUILTINS = new Set(['BASE_URL', 'MODE', 'DEV', 'PROD', 'SSR']);

/** Shipped JS only: no tests, no build tooling, no node_modules. */
function shippedFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { shippedFiles(p, out); continue; }
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
    if (name.endsWith('.config.js')) continue;
    out.push(p);
  }
  return out;
}

const FILES = [...shippedFiles(join(ROOT, 'src/js')), ...shippedFiles(join(ROOT, 'passport/js'))];

/**
 * Every read site: the file, the name, and the ~120 characters after it, which
 * is where an inline `|| fallback` would be.
 */
function readSites() {
  const sites = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    const re = /import\.meta\.env\s*\??\.\s*([A-Z][A-Z0-9_]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (BUILTINS.has(name)) continue;
      sites.push({
        file: relative(ROOT, file),
        name,
        tail: src.slice(m.index + m[0].length, m.index + m[0].length + 120),
        src,
      });
    }
  }
  return sites;
}

const SITES = readSites();
const NAMES = [...new Set(SITES.map((s) => s.name))].sort();

/**
 * A USABLE fallback immediately after the read: `|| 'https://…'` or `|| IDENT`.
 *
 * ⛔ AN EMPTY FALLBACK IS NOT A FALLBACK — IT IS THE BUG.
 * The first version of this guard accepted any quote after `||`, so
 * `import.meta.env?.VITE_GAS_UPLOAD_URL || ''` — the exact line that removed the
 * passport's upload button — read as "covered" and the guard stayed GREEN when
 * the original defect was reintroduced. Caught only by running that mutation.
 * `''`, `null`, `undefined`, `false` and `0` all leave `if (!x)` reachable, so
 * the value is still silently absent; those need an ANNOUNCED branch instead.
 */
const EMPTY_FALLBACK = /^\s*\|\|\s*(''|""|``|null|undefined|false|0)\s*(;|,|\)|$|\n)/;
const hasInlineFallback = (site) =>
  /^\s*\|\|\s*(['"`]|[A-Za-z_$])/.test(site.tail) && !EMPTY_FALLBACK.test(site.tail);

/** A branch that tests the value and SAYS something when it is missing. */
function announcesAbsence(name, allSrc) {
  // Follow the value through its assignments — `VITE_X` -> `const X = …` ->
  // `const X_CONFIGURED = Boolean(X && …)` — because the branch that speaks is
  // usually two names away from the read (admin-scope.js does exactly this).
  let idents = new Set([name]);
  for (let depth = 0; depth < 3; depth += 1) {
    const before = idents.size;
    for (const id of [...idents]) {
      for (const m of allSrc.matchAll(
        new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;\\n]*\\b${id}\\b`, 'g'),
      )) idents.add(m[1]);
    }
    if (idents.size === before) break;
  }
  return [...idents].some((id) => {
    const guard = new RegExp(
      `(?:if\\s*\\(\\s*!\\s*${id}\\b|!${id}\\s*(?:\\|\\||\\))|${id}\\s*===?\\s*(?:''|""|null|undefined|false))`,
    );
    if (!guard.test(allSrc)) return false;
    // ⛔ It must SAY something. A silent `if (!x) return` does NOT count — that
    // is precisely the passport bug: wireUpload() returned, painting nothing.
    return /throw new Error|console\.(error|warn)/.test(allSrc);
  });
}

describe('the build-time env contract', () => {
  it('found the reads at all (a sweep that finds nothing must prove it looked)', () => {
    expect(FILES.length, 'no shipped JS scanned — the walker is broken').toBeGreaterThan(40);
    expect(SITES.length, 'no import.meta.env reads found — the regex is broken').toBeGreaterThan(8);
    expect(NAMES).toContain('VITE_SUPABASE_URL');
  });

  // THE PROPERTY.
  it('⛔ every VITE_* read is covered — fallback, announced, or tolerated WITH a reason', () => {
    const silent = [];
    for (const name of NAMES) {
      if (TOLERATED_SILENT[name]) continue;
      const sites = SITES.filter((s) => s.name === name);
      const covered = sites.some((s) => hasInlineFallback(s))
        || sites.some((s) => announcesAbsence(name, s.src));
      if (!covered) silent.push({ name, at: sites.map((s) => s.file) });
    }
    expect(silent, [
      silent.map((s) => `  ${s.name} — read in ${[...new Set(s.at)].join(', ')}`).join('\n'),
      '',
      'These are read from import.meta.env with nothing to say when they are absent.',
      'That is not a hypothetical: `import.meta.env.X` is SUBSTITUTED at build time,',
      'so an unset variable is not an error, not a crash and not a log — it folds',
      'into the bundle as a literal and quietly changes what the app does. It cost',
      'the passport admin its ⬆️ Upload button for eleven days while npm test and',
      'npm run build both passed (docs/mistakes/passport.md).',
      '',
      'Pick one, in this order of preference:',
      '  1. A CHECKED-IN FALLBACK — `|| DEFAULT_X`. Best answer by far. Ask what',
      '     secrecy the env indirection actually buys; for a public URL or a',
      '     feature flag it buys nothing, and env is where values get LOST (a repo',
      '     merge, a fresh clone, a retired CI dashboard).',
      '  2. AN ANNOUNCED ABSENCE — throw, or console.error/warn on the branch that',
      '     sees it missing. A silent `if (!x) return` does NOT count; that IS the',
      '     bug this guard exists for.',
      '  3. TOLERATED_SILENT in this file — only if absence is the INTENDED',
      '     production meaning, and only with the reason written out.',
    ].join('\n')).toEqual([]);
  });

  // The passport half has NO env file of its own and its names are not in the
  // contributor contract, so an announcement there reaches nobody at build time.
  // It gets the stricter rule: a fallback, always.
  it('⛔ every VITE_* read under passport/ has a checked-in fallback', () => {
    const bare = SITES
      .filter((s) => s.file.startsWith('passport/') && !hasInlineFallback(s))
      .filter((s) => !PASSPORT_NO_FALLBACK[`${s.file}::${s.name}`])
      .map((s) => `  ${s.file} — ${s.name}`);
    expect(bare, [
      bare.join('\n'),
      '',
      'passport/ carries no .env* (they were gitignored in the old standalone repo',
      'and could not survive the subtree merge), and passport/vite.config.js pins',
      '`root` there — which is also vite\'s default envDir. Every VITE_* in that',
      'half therefore resolves to undefined in a production build unless the repo',
      'root supplies it, and nothing routes a contributor to set one. Give it a',
      'checked-in default. This is the exact shape that removed the admin upload',
      'button: `import.meta.env?.VITE_GAS_UPLOAD_URL || \'\'`.',
    ].join('\n')).toEqual([]);
  });

  it('every exemption carries a real reason, and none is dead', () => {
    for (const [name, reason] of Object.entries(TOLERATED_SILENT)) {
      expect(reason.length, `${name}'s exemption needs a real explanation, not a label`)
        .toBeGreaterThan(120);
      expect(NAMES, `${name} is exempted but nothing reads it — delete the entry`)
        .toContain(name);
    }
    // A stale exemption is worse than none: it says a hazard was considered when
    // the code it described is gone. Both registries are checked for dead keys.
    for (const [key, reason] of Object.entries(PASSPORT_NO_FALLBACK)) {
      expect(reason.length, `${key} needs a real explanation, not a label`).toBeGreaterThan(120);
      const [file, name] = key.split('::');
      expect(
        SITES.some((s) => s.file === file && s.name === name),
        `${key} is exempted but that file no longer reads that name — delete the entry`,
      ).toBe(true);
    }
  });
});
