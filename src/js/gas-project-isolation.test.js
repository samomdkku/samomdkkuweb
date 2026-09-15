// ============================================================
// gas-project-isolation.test.js — the two Apps Script deploy tools must never
// read the same env key.
//
// THE NEAR-MISS THIS EXISTS FOR (2026-09-15). There are THREE Apps Script
// projects and this repo deploys two of them:
//
//   npm run deploy:gas           → tools/deploy-gas.mjs          → appscript/prform.gs
//                                  (PR / shop / project Drive uploads + the
//                                   หนังสือโครงการ email — MailApp, quota-bound)
//   npm run deploy:gas:passport  → passport/tools/deploy-gas.mjs → passport/gas/Upload.gs
//                                  (badge + certificate image uploads)
//
// Before the 2026-09-04 merge each lived in its OWN repo and read
// `GAS_SCRIPT_ID` from its OWN gitignored `.env.local`, so the shared name was
// harmless. After the merge there is ONE `.env.local`, and it already holds
// samoweb's id under that bare name. The passport tool was reading a
// passport/.env* that no longer exists, so it simply died — and the obvious
// repair ("point it at the repo root like everything else") would have made it
// push gas/Upload.gs OVER samoweb's project. One script has one doPost: PR,
// shop and project uploads and the projects email would all have stopped, from
// a change whose diff looks like a path fix.
//
// The property: the two tools name DIFFERENT keys. Asserted from the sources,
// with a control, so an empty result cannot pass for agreement.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const WEB = readFileSync(join(ROOT, 'tools/deploy-gas.mjs'), 'utf8');
const PASS = readFileSync(join(ROOT, 'passport/tools/deploy-gas.mjs'), 'utf8');

/** Every `ENV.<NAME>` / `ENV['<NAME>']` a tool reads, plus its allow-list entries. */
const keysRead = (src) => new Set([
  ...[...src.matchAll(/\bENV\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  ...[...src.matchAll(/'([A-Z][A-Z0-9_]*GAS[A-Z0-9_]*)'/g)].map((m) => m[1]),
]);

describe('the two Apps Script deploy tools', () => {
  it('both read env keys at all (a sweep that finds nothing must prove it looked)', () => {
    expect(keysRead(WEB).size).toBeGreaterThan(0);
    expect(keysRead(PASS).size).toBeGreaterThan(0);
  });

  it('⛔ never share a script-id key — one .env.local, two projects', () => {
    const shared = [...keysRead(WEB)].filter((k) => keysRead(PASS).has(k) && /SCRIPT_ID|DEPLOYMENT_ID/.test(k));
    expect(shared, [
      `tools/deploy-gas.mjs and passport/tools/deploy-gas.mjs both read: ${shared.join(', ')}`,
      '',
      'They target DIFFERENT Apps Script projects but now share one .env.local.',
      "A shared name means whichever value is in the file decides which project",
      'gets overwritten. Pushing passport/gas/Upload.gs over samoweb\'s project',
      'takes down PR/shop/project Drive uploads AND the หนังสือโครงการ email.',
      'Keep the passport tool on PASSPORT_GAS_* names.',
    ].join('\n')).toEqual([]);
  });

  it('the passport tool is on PASSPORT_GAS_* names specifically', () => {
    expect(PASS).toContain('PASSPORT_GAS_SCRIPT_ID');
    expect(PASS).not.toMatch(/ENV\.GAS_SCRIPT_ID\b/);
  });

  it('the samoweb tool still owns the bare GAS_SCRIPT_ID (the control)', () => {
    expect(WEB).toMatch(/GAS_SCRIPT_ID/);
  });

  it('the passport tool reads its endpoint from the shipped source, not a second copy', () => {
    // If this tool kept its own literal, the URL it verifies could drift from
    // the URL the bundle calls — and a deploy would report success against an
    // endpoint nobody uses.
    expect(PASS).toContain('defaultEndpointFromSource');
    expect(PASS).toMatch(/DEFAULT_GAS_URL/);
    const literals = [...PASS.matchAll(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g)];
    expect(literals.map((m) => m[0]), 'the passport deploy tool must hold NO hardcoded /exec URL')
      .toEqual([]);
  });
});
