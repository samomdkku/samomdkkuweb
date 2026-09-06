// ==============================================
// `npm run env:pull` — the owner stops being the delivery mechanism.
//
// Owner, 2026-09-06: *"but then i have to be access to my computer to can do
// it"* and *"i would have to send it many times for each person isn't it"*.
// Both are the same problem — `env:share` needs a laptop and a person awake,
// once per contributor, for ever. env:pull removes them from the loop: the
// values sit in the vault once and each person fetches their own.
//
// ⚠️ WHAT THESE CAN AND CANNOT PROVE. Everything up to authentication was
// measured against the LIVE vault on 2026-09-06 (see tools/env-pull.mjs's
// header). An authenticated fetch has NOT been run — no `Dev` collection
// existed yet — so these assert the parts that do not need an account, plus the
// two safety properties that would matter most if the rest works.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockFromItem } from '../../tools/env-pull.mjs';
import { VAULT_URL, VAULT_ITEM } from '../../tools/vault-config.mjs';
import { parsePaste, productionNames } from '../../tools/setup-env.mjs';
import { REQUIRED } from '../../tools/env-check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the vault address has one home', () => {
  it('agrees with skills/vaultwarden.md — a second copy is how it rots', () => {
    expect(read('skills/vaultwarden.md'), 'the skill no longer names the vault '
      + 'address this tool points at; one of the two is stale').toContain(VAULT_URL);
  });

  it('has no trailing slash — bw appends /api and /identity to it', () => {
    // Measured: bw stores this as `base` and derives the rest. A trailing slash
    // gives `//api` and a 404 that reads like the vault being down.
    expect(VAULT_URL).not.toMatch(/\/$/);
    expect(VAULT_URL).toMatch(/^https:\/\//);
  });

  it('points at the SAMO vault, never bitwarden.com', () => {
    expect(VAULT_URL).not.toContain('bitwarden.com');
  });
});

describe('reading the env block out of a vault item', () => {
  const item = (notes) => JSON.stringify({ object: 'item', name: VAULT_ITEM, notes });

  it('takes the Notes field, which is what env:share output is pasted into', () => {
    const block = REQUIRED.map((n) => `${n}=value-for-${n}`).join('\n');
    expect(blockFromItem(item(block)).text).toBe(block);
  });

  it('survives the block being pasted with env:share\'s surrounding chatter', () => {
    // A maintainer copying from the terminal will bring the rules along.
    const block = `  ─────────────\n${REQUIRED.map((n) => `${n}=v-${n}`).join('\n')}\n  ─────────────\n  Not by LINE...`;
    const parsed = parsePaste(blockFromItem(item(block)).text);
    for (const n of REQUIRED) expect(parsed[n]).toBe(`v-${n}`);
  });

  it('says so plainly when the item is empty rather than writing nothing', () => {
    expect(blockFromItem(item('')).error).toMatch(/empty Notes/);
    expect(blockFromItem(item(undefined)).error).toMatch(/empty Notes/);
  });

  it('does not throw on whatever the CLI hands back', () => {
    expect(blockFromItem('not json at all').error).toBeTruthy();
    expect(blockFromItem('null').error).toBeTruthy();
    expect(blockFromItem('[]').error).toBeTruthy();
  });
});

describe('the two refusals that matter if someone fills the item wrongly', () => {
  it('a production credential in the vault item is recognised, not written', () => {
    // The dangerous mistake is pasting the WRONG block into a shared item —
    // it is then readable by everyone the collection is shared with.
    const example = read('.env.local.example');
    const bad = parsePaste('SUPABASE_DEV_URL=https://a.supabase.co\nSAMO_VM_SUDO_PASSWORD=hunter2');
    const leaked = productionNames(example).filter((n) => n in bad);
    expect(leaked, 'env:pull would have written a production credential from a '
      + 'shared vault item').toContain('SAMO_VM_SUDO_PASSWORD');
  });

  it('control: a correct item trips no refusal', () => {
    const example = read('.env.local.example');
    const good = parsePaste(REQUIRED.map((n) => `${n}=v`).join('\n'));
    expect(productionNames(example).filter((n) => n in good)).toEqual([]);
  });
});

describe('env:pull never prints a value', () => {
  it('logs names only — a terminal is one of the places these must not land', () => {
    const src = read('tools/env-pull.mjs');
    // Every console.log of a per-name loop must print the NAME, not write[n].
    expect(src, 'env-pull logs a value').not.toMatch(/console\.log\([^)]*write\[[^\]]+\]/);
    expect(src, 'env-pull logs the parsed block').not.toMatch(/console\.log\(\s*text\s*\)/);
  });

  it('locks the vault again on every exit path it opens one', () => {
    const src = read('tools/env-pull.mjs');
    const unlocks = (src.match(/--raw/g) || []).length;
    const locks = (src.match(/'lock'/g) || []).length;
    expect(locks, 'a path unlocks the vault and never locks it again')
      .toBeGreaterThanOrEqual(unlocks);
  });
});
