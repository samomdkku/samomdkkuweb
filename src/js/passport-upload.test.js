// ============================================================
// passport-upload.test.js — the admin's ⬆️ Upload button must EXIST.
//
// THE OUTAGE THIS EXISTS FOR (reported 2026-09-15, "the upload badge image
// button of samopassport is gone"):
//
//   passport/js/upload.js read its Drive endpoint ONLY from
//   `VITE_GAS_UPLOAD_URL`. That value lived in the old standalone passport
//   repo's gitignored `.env`; the 2026-09-04 monorepo merge copied the TRACKED
//   files, so it did not travel. And `passport/vite.config.js` pins `root` to
//   passport/ — which is also vite's default `envDir` — so not even the repo
//   root's `.env.local` could have supplied it. `import.meta.env` compiled to
//   `{}`, `isUploadConfigured()` went false, and `wireUpload()` returned before
//   creating the button. THREE fields lost it at once (act-badge-url,
//   edit-badge-url, cert-bg-url) and the only signal was a `console.info`.
//
// WHY THIS SHAPE OF ASSERTION. Grepping the built bundle for the string
// "⬆️ Upload" does NOT work and was tried: the string survives minification in
// BOTH the working and the broken build, because rollup does not fold the
// cross-module `isUploadConfigured()` call. The thing that actually differs is
// whether an endpoint RESOLVES. So this asserts the property directly — with
// the environment emptied to exactly the production condition — rather than the
// presence of any list, name or literal the code could be wrong about.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const UPLOAD_SRC = readFileSync(join(ROOT, 'passport/js/upload.js'), 'utf8');
const ADMIN_SRC = readFileSync(join(ROOT, 'passport/js/admin-page.js'), 'utf8');
const VITE_CFG = readFileSync(join(ROOT, 'passport/vite.config.js'), 'utf8');

afterEach(() => vi.unstubAllEnvs());

describe('the passport admin image upload', () => {
  it('reads the real modules (a sweep that finds nothing must prove it looked)', () => {
    expect(UPLOAD_SRC).toContain('isUploadConfigured');
    expect(ADMIN_SRC).toContain('function wireUpload');
  });

  // THE PROPERTY. Production builds carry no VITE_GAS_UPLOAD_URL — that is the
  // whole point of the fix — so this stubs the var empty and demands an endpoint
  // anyway. Reintroduce the bug (drop the `|| DEFAULT_GAS_URL`) and this goes red.
  it('has a Drive endpoint with NO environment at all — the production condition', async () => {
    vi.stubEnv('VITE_GAS_UPLOAD_URL', '');
    vi.resetModules();
    const { isUploadConfigured } = await import('../../passport/js/upload.js');
    expect(isUploadConfigured(), [
      'passport/js/upload.js resolved NO upload endpoint with the environment empty.',
      'That is exactly the state every production build is in, and it makes',
      'wireUpload() return before creating the ⬆️ Upload button on act-badge-url,',
      'edit-badge-url and cert-bg-url. Pin a checked-in default; a GAS /exec URL',
      'is a public webhook, not a secret (.claude/rules/security.md).',
    ].join('\n')).toBe(true);
  });

  it('pins that default as a real Apps Script /exec, not a placeholder', () => {
    const m = UPLOAD_SRC.match(/const DEFAULT_GAS_URL\s*=\s*'([^']+)'/);
    expect(m, 'passport/js/upload.js must pin DEFAULT_GAS_URL').not.toBeNull();
    expect(m[1]).toMatch(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/);
  });

  // The button is INJECTED, never written in html/admin.html — so "the markup is
  // still there" is not evidence the control exists. Pin that wireUpload is
  // still called for every field that takes an image URL.
  it('wires every image-URL field the admin can fill', () => {
    for (const field of ['act-badge-url', 'edit-badge-url', 'cert-bg-url']) {
      expect(ADMIN_SRC, `wireUpload('${field}') is gone — that field lost its ⬆️ Upload button`)
        .toContain(`wireUpload('${field}'`);
    }
  });
});

describe('the legacy admin/1234 door', () => {
  // The SAME outage, other half. VITE_PASSPORT_ADMIN_* were in the old repo's
  // gitignored .env.local and did not survive the merge either, so
  // LEGACY_LOGIN_CONFIGURED has been false in production ever since — while the
  // box that takes the password was gated on LEGACY_PASSWORD_LOGIN alone, a
  // hardcoded `true`. It was drawn, accepted admin/1234, and answered with a
  // Thai error naming a build-time env var to someone who has no build.
  //
  // Asserted on the SOURCE, not on a rendered page: whether the credentials are
  // present is a legitimate deployment choice, so a test that demanded the box
  // be hidden would go red the day somebody correctly configured it. The
  // invariant that holds either way is that the gate ASKS.
  it('is drawn only when it can actually open', () => {
    const line = ADMIN_SRC.split('\n').find((l) => l.includes("getElementById('admin-legacy-box')")
      || (l.includes('legacyBox') && l.includes('display')));
    expect(ADMIN_SRC, 'admin-page.js must import LEGACY_LOGIN_CONFIGURED')
      .toContain('LEGACY_LOGIN_CONFIGURED');
    const gate = ADMIN_SRC.match(/if \(legacyBox[^)]*\) legacyBox\.style\.display/);
    expect(gate, `could not find the legacy-box display gate (nearest line: ${line})`).not.toBeNull();
    expect(gate[0], [
      'the legacy admin/1234 box is shown without asking whether the shared',
      'account it signs into is configured. LEGACY_PASSWORD_LOGIN is a hardcoded',
      'true — it says the hatch exists in this build, not that it can open.',
      'A control that cannot work should not be drawn.',
    ].join('\n')).toContain('LEGACY_LOGIN_CONFIGURED');
  });
});

describe('the passport build environment', () => {
  // The CLASS, not the instance: passport/ holds no `.env*` and is not supposed
  // to. Any VITE_* a passport module reads resolves only if envDir points at the
  // repo root, where the one `.env.local` lives.
  it('takes env from the repo root, not from passport/', () => {
    expect(VITE_CFG, [
      'passport/vite.config.js must set `envDir` to the repo root.',
      "vite's envDir DEFAULTS to `root`, which this config pins to passport/ —",
      'a directory with no .env* in it. Leaving it default makes import.meta.env',
      'compile to {} in every production build, silently blanking every VITE_*',
      'a passport module reads. That is how the ⬆️ Upload button disappeared.',
    ].join('\n')).toMatch(/envDir:\s*resolve\(__dirname,\s*'\.\.'\)/);
  });

  it('still lets the samo-dev override win over the root .env.local', () => {
    // vite's loadEnv applies dotfiles first, then lets process.env OVERWRITE
    // them, so applyDevDatabaseEnv()'s samo-dev values still beat a maintainer's
    // production VITE_SUPABASE_* in .env.local. Pin that this config keeps
    // calling it, and only on serve.
    expect(VITE_CFG).toMatch(/command === 'serve'.*applyDevDatabaseEnv\(\)/s);
  });
});
