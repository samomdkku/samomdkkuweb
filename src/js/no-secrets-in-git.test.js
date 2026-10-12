// ============================================================
// no-secrets-in-git.test.js — no tracked file may carry a live credential.
//
// REPORTED (2026-09-25): "тест / сообщение 1…10" in vs-ดิจิทัล, posted by our
// own "VitalSound Hook". Twelve webhook URLs had been committed to this PUBLIC
// repo months earlier and removed two weeks later — removal does nothing once
// history is public. The same sweep found the database's service_role key,
// committed in a file named `env.local`: no leading dot, so `.gitignore`'s
// `.env.local` never matched it. Both were rotated; history keeps the dead copies.
//
// So this asserts the PROPERTY, not a list of known filenames:
//   1. every tracked env-shaped file is an `.example`;
//   2. no tracked text file contains a credential-SHAPED string.
// Each sweep has a control (a synthetic sample the pattern must catch), so an
// empty result means "clean", never "the regex matches nothing".
//
// ⚠️ This file must not itself contain a match — the samples below are built
// by concatenation at run time for that reason.
// ============================================================
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const textFiles = tracked
  .filter((f) => !f.startsWith('docs/demos/about-3d/package/'))
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|glb|hdr|xlsx)$/i.test(f));

const read = (f) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } };

// `env.local`, `.env`, `.env.production`, `prod.env` — any basename with `env`
// as a dot-separated part. The `.example` files are the contract and stay tracked.
const ENV_SHAPED = /(^|\.)env(\.|$)/i;

const SHAPES = {
  // three base64url segments, the first two JSON — every Supabase legacy key
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  supabaseSecret: /sb_secret_[A-Za-z0-9_-]{16,}/,
  supabasePat: /sbp_[a-f0-9]{32,}/,
  discordWebhook: /discord(?:app)?\.com\/api\/webhooks\/\d{15,}\/[A-Za-z0-9_-]{30,}/,
  // a hosted Supabase DB URL with a real-length password (fixtures use `x`)
  supabaseDbUrl: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{12,}@[^/\s]*supabase\.(?:co|com)/,
};

// Synthetic positives, assembled so this file never contains one literally.
const b = (n, c = 'A') => c.repeat(n);
const SAMPLES = {
  jwt: 'ey' + 'J' + b(20) + '.ey' + 'J' + b(20) + '.' + b(20),
  supabaseSecret: 'sb_' + 'secret_' + b(32),
  supabasePat: 'sb' + 'p_' + b(40, 'a'),
  discordWebhook: 'https://discord.com/api/' + 'webhooks/' + '1'.repeat(18) + '/' + b(60),
  supabaseDbUrl: 'postgresql://' + 'postgres.ref:' + b(20) + '@aws-0.pooler.' + 'supabase.com:6543/postgres',
};

describe('no env file is tracked except an .example', () => {
  const envFiles = tracked.filter((f) => ENV_SHAPED.test(basename(f)));

  it('control: the sweep sees the .example files', () => {
    expect(envFiles).toContain('.env.local.example');
  });

  it('every env-shaped tracked file ends in .example', () => {
    expect(envFiles.filter((f) => !f.endsWith('.example'))).toEqual([]);
  });

  it('control: `env.local` (no dot) is env-shaped', () => {
    expect(ENV_SHAPED.test('env.local')).toBe(true);
    expect(ENV_SHAPED.test('environment.js')).toBe(false);
  });
});

describe('no tracked file carries a credential-shaped string', () => {
  for (const [name, re] of Object.entries(SHAPES)) {
    it(`control: the ${name} pattern catches a sample`, () => {
      expect(re.test(SAMPLES[name])).toBe(true);
    });

    it(`no ${name} in any tracked file`, () => {
      const hits = textFiles.filter((f) => re.test(read(f)));
      expect(hits).toEqual([]);
    });
  }

  it('control: the sweep reads real file contents', () => {
    expect(textFiles.length).toBeGreaterThan(100);
    expect(read('package.json')).toContain('"name"');
  });
});
