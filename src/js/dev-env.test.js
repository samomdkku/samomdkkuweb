// ==============================================
// THE SETUP THE GUIDE PRODUCES MUST GIVE THE APP A DATABASE.
//
// The bug: `.env.local.example` declared SUPABASE_DEV_URL / SUPABASE_DEV_ANON_KEY,
// `src/js/db.js` read VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, and NOTHING
// joined them. A contributor did every step right, `npm run env:check` printed
// "✓ You are set up", and the portal loaded with no database while PASSPORT
// fell back to its hardcoded PRODUCTION url. Measured 2026-09-06.
//
// ⚠️ WHY THE EXISTING GUARD WAS GREEN. env-example.test.js asserted that the
// example declares four names and that the docs name the same four — a list
// against a list, both derived from the same decision. It could not see the
// hazard, because the hazard lived in the gap between the example and the app
// (`.claude/rules/mistakes.md` class 7). Everything below asserts the PROPERTY
// those lists were meant to produce: feed in the file the guide tells a person
// to create, and a real database must come out.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideDevDatabase, applyDevDatabaseEnv, PROD_OVERRIDE, envDrift, describeDrift,
} from '../../tools/dev-env.mjs';
import { manifest } from '../../tools/env-manifest.mjs';
import { selectNames } from '../../tools/env-share.mjs';
import { ribbonLabel } from './env-ribbon.js';
import { REQUIRED, OPTIONAL, isPlaceholder } from '../../tools/env-check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const EXAMPLE = read('.env.local.example');
const EXAMPLE_TEXT = EXAMPLE;

/**
 * The file a contributor ends up with, built FROM the example rather than
 * retyped here — so a name added to the example is covered without anyone
 * remembering to update this test.
 */
function contributorEnv(overrides = {}) {
  const env = {};
  for (const m of EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) env[m[1]] = m[2];
  // They replaced the placeholders with what they were sent.
  env.SUPABASE_DEV_URL = 'https://devprojectref1234.supabase.co';
  env.SUPABASE_DEV_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInBsYXVzaWJsZSI6dHJ1ZX0';
  return { ...env, ...overrides };
}

describe('the file the guide tells a contributor to create', () => {
  it('gives the dev server a database (the bug, asserted directly)', () => {
    const d = decideDevDatabase(contributorEnv(), {});
    expect(d.use, `a correct contributor setup resolved to "${d.use}" (${d.reason}) — `
      + 'this is the exact failure of 2026-09-06: green check, dead app').toBe('dev');
    expect(d.url).toBe('https://devprojectref1234.supabase.co');
  });

  it('needs ONLY the values env-check requires — no hidden fourth thing', () => {
    // Built from REQUIRED, so narrowing that list cannot quietly break this.
    const only = {};
    for (const n of REQUIRED) only[n] = contributorEnv()[n];
    expect(decideDevDatabase(only, {}).use,
      'someone sent only the REQUIRED values and the dev server still has no '
      + 'database — REQUIRED and the dev server disagree about what is needed')
      .toBe('dev');
  });

  it('control: an empty file resolves to nothing, so the check above can fail', () => {
    expect(decideDevDatabase({}, {}).use).toBe('unset');
  });

  it('a half-finished setup points at NOTHING, never at a made-up host', () => {
    // The placeholders straight out of the example, unedited.
    const raw = {};
    for (const m of EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) raw[m[1]] = m[2];
    expect(raw.SUPABASE_DEV_URL, 'the example stopped shipping a URL placeholder')
      .toBeTruthy();
    expect(isPlaceholder('SUPABASE_DEV_URL', raw.SUPABASE_DEV_URL)).toBe(true);
    expect(decideDevDatabase(raw, {}).use).toBe('unset');
  });
});

describe('the two names the app reads and the two we set are the same two', () => {
  it('matches db.js, read from db.js — not from a list retyped here', () => {
    // A differential test across the seam the bug lived in. Rename either side
    // and this goes red; that is the whole point.
    const appReads = [...read('src/js/db.js')
      .matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(appReads.length, 'db.js stopped reading import.meta.env at all')
      .toBeGreaterThan(0);

    // What applyDevDatabaseEnv actually writes, observed rather than declared:
    // give it a real file and see which keys appear on the env object.
    const procEnv = {};
    applyDevDatabaseEnv(procEnv, join(ROOT, '.env.local'));
    const set = Object.keys(procEnv).filter((k) => k.startsWith('VITE_SUPABASE_'));
    expect(set.length, 'applyDevDatabaseEnv set no VITE_SUPABASE_* at all — either '
      + 'there is no .env.local here, or the mapping is gone').toBeGreaterThan(0);

    for (const name of appReads) {
      expect(set, `src/js/db.js reads ${name}, which nothing in `
        + 'tools/dev-env.mjs ever sets — that gap IS the bug this file guards')
        .toContain(name);
    }
  });
});

describe('what vite.config.js is allowed to import', () => {
  // ⛔ PAID FOR ON 2026-09-06. Vite BUNDLES its config plus everything the
  // config imports into one module. A `#!/usr/bin/env node` shebang that is no
  // longer on line 1 is a syntax error, so importing a CLI tool from the config
  // made the entire test suite fail to START with:
  //
  //     tools/env-check.mjs:1:396: ERROR: Syntax error "!"
  //
  // Loud, but it names a column in a file whose line 1 is 19 characters, and it
  // says nothing about shebangs. This turns that into a sentence.
  it('nothing in the config import graph carries a shebang', () => {
    const seen = new Set();
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = read(rel);
      expect(src.startsWith('#!'), `${rel} starts with a shebang and is reachable `
        + 'from vite.config.js. Vite bundles the config, so the shebang lands '
        + 'mid-file and esbuild refuses it — move the shared part into a file '
        + 'with no shebang, as tools/env-manifest.mjs was').toBe(false);
      for (const m of src.matchAll(/^import[^']*'(\.[^']+)'/gm)) {
        const dir = rel.split('/').slice(0, -1).join('/');
        walk(join(dir, m[1]).replace(`${ROOT}/`, '').replace(/^\/+/, ''));
      }
    };
    for (const entry of ['vite.config.js', 'passport/vite.config.js']) walk(entry);
    expect(seen.size, 'the walk found no files — it is not looking at anything')
      .toBeGreaterThan(2);
  });
});

describe('a production build must never be repointed', () => {
  // The one way this change could do real damage: if the mapping ran during
  // `vite build`, the VM would ship a bundle wired to samo-dev while every
  // other signal said production. Both configs gate on the command.
  for (const cfg of ['vite.config.js', 'passport/vite.config.js']) {
    it(`${cfg} applies it only when command === 'serve'`, () => {
      const src = read(cfg);
      expect(src, `${cfg} does not call applyDevDatabaseEnv at all`)
        .toMatch(/applyDevDatabaseEnv/);
      expect(src, `${cfg} calls applyDevDatabaseEnv without gating on the command — `
        + 'a production build would be wired to samo-dev')
        .toMatch(/command === 'serve'[\s\S]{0,200}applyDevDatabaseEnv/);
    });
  }

  it('the live database is reachable in dev, but only if you say so out loud', () => {
    const env = contributorEnv();
    expect(decideDevDatabase(env, {}).use).toBe('dev');
    expect(decideDevDatabase(env, { [PROD_OVERRIDE]: '1' }).use).toBe('production');
  });
});

describe('the split between "run the site" and "work on the database"', () => {
  // ⛔ Handing every volunteer SUPABASE_DEV_DB_URL meant handing them a
  // connection that ignores every permission rule, over an unmasked copy of
  // real student records. These assert the split has not quietly collapsed.
  it('the powerful two are commented out in the example, not fill-in lines', () => {
    const uncommented = new Set(
      [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
    for (const name of OPTIONAL) {
      expect(uncommented, `${name} is presented as a line to fill in. It can `
        + 'delete the project or read every student record; it must stay '
        + 'commented out so nobody is sent it by default').not.toContain(name);
    }
    for (const name of REQUIRED) {
      expect(uncommented, `${name} is needed to run the site but is not an `
        + 'active line in the example').toContain(name);
    }
  });

  it('the two lists do not overlap, and together are what the tools use', () => {
    expect(REQUIRED.filter((n) => OPTIONAL.includes(n))).toEqual([]);
    // Derived from the tools themselves: anything a tool reads must be in one
    // list or the other, or a contributor can be blocked by a name nobody names.
    const used = new Set();
    for (const f of ['migrations-lib.mjs', 'apply-migration.mjs', 'run-proofs.mjs',
      'dev-check.mjs', 'dev-grants.mjs', 'dev-refresh.mjs', 'dev-google-signin.mjs']) {
      for (const m of read(`tools/${f}`).matchAll(/\bSUPABASE_DEV_[A-Z_]+/g)) used.add(m[0]);
    }
    expect(used.size, 'no tool reads a SUPABASE_DEV_* name — the sweep found nothing')
      .toBeGreaterThan(0);
    for (const name of used) {
      expect([...REQUIRED, ...OPTIONAL], `${name} is read by a tool but appears in `
        + 'neither REQUIRED nor OPTIONAL').toContain(name);
    }
  });
});

describe('a variable added LATER reaches everyone, with no code change', () => {
  // ⛔ THE OWNER'S ACTUAL QUESTION: *"incase in the future there's more key, or
  // key is changed, it would be tiresome to manually copy paste each key"*.
  // The answer is that `.env.local.example` is the only place that decides, so
  // one edit there is the whole change. These assert that, by ADDING a variable
  // to a copy of the example and checking each tool notices — rather than
  // trusting that they all read the same function.
  const FUTURE = 'SUPABASE_DEV_STORAGE_KEY';
  const grown = () => `${EXAMPLE_TEXT}\n${FUTURE}=paste-the-storage-key-here\n`;

  it('control: nothing warns about it before it is added', () => {
    expect(envDrift(EXAMPLE_TEXT, contributorEnv()).missing).toEqual([]);
  });

  it('an existing contributor is told, by name, on their next npm run dev', () => {
    const drift = envDrift(grown(), contributorEnv());
    expect(drift.missing).toContain(FUTURE);
    expect(describeDrift(drift)).toContain(FUTURE);
    expect(describeDrift(drift)).toContain('npm run setup');
  });

  it('env:share offers it without being told about it', () => {
    expect(selectNames(grown(), {}).names).toContain(FUTURE);
  });

  it('npm run setup accepts it without being told about it', () => {
    expect(manifest(grown()).required).toContain(FUTURE);
  });

  it('a COMMENTED addition is optional, not required — the split still holds', () => {
    const optionalAdd = `${EXAMPLE_TEXT}\n# ${FUTURE}=paste-me\n`;
    expect(manifest(optionalAdd).optional).toContain(FUTURE);
    expect(envDrift(optionalAdd, contributorEnv()).missing).not.toContain(FUTURE);
  });
});

describe('the drift warning stays silent when nothing is wrong', () => {
  // A warning that fires on the healthy case is worse than no warning, and one
  // a contributor cannot act on is worse still (`.claude/rules/mistakes.md`).
  it('says nothing to a correct two-value contributor', () => {
    expect(describeDrift(envDrift(EXAMPLE_TEXT, contributorEnv()))).toBe('');
  });

  it('never nags about the database-work values they are right not to have', () => {
    const drift = envDrift(EXAMPLE_TEXT, contributorEnv());
    for (const n of OPTIONAL) expect(drift.missing).not.toContain(n);
  });

  it('does speak up when a placeholder was left behind', () => {
    const raw = {};
    for (const m of EXAMPLE_TEXT.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) raw[m[1]] = m[2];
    expect(describeDrift(envDrift(EXAMPLE_TEXT, raw))).toMatch(/placeholder/);
  });
});

describe('the dev server and the ribbon agree that localhost is not production', () => {
  // A differential test across two files that only meet at runtime:
  // dev-env.mjs SETS the variable, env-ribbon.js READS it. Neither file's own
  // tests can see the join, and docs/start/where-it-runs.md was stale about it
  // for exactly that reason.
  it('a local dev run paints a ribbon', () => {
    const env = {};
    applyDevDatabaseEnv(env, join(ROOT, '.env.local'));
    expect(env.VITE_ENV_NAME, 'dev-env stopped setting VITE_ENV_NAME, so a local '
      + 'run now looks identical to production in the browser').toBeTruthy();
    expect(ribbonLabel(env.VITE_ENV_NAME, 'localhost'),
      'the value dev-env sets does not make the ribbon paint').toBeTruthy();
  });

  it('control: without it, localhost paints nothing — the pre-2026-09-06 state', () => {
    expect(ribbonLabel(undefined, 'localhost')).toBe(null);
  });

  it('and it never claims to be production', () => {
    const env = {};
    applyDevDatabaseEnv(env, join(ROOT, '.env.local'));
    expect(env.VITE_ENV_NAME).not.toBe('production');
  });
});
