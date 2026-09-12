// ==============================================
// discord-provision.test.js — the four things provisioning must never do.
//
// This is the first tool in the Discord work that WRITES, to Discord and to the
// database, so the guarantees the report gets for free have to be asserted here
// one at a time.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CODE = stripComments(readFileSync(join(ROOT, 'tools', 'discord-provision.mjs'), 'utf8'));

describe('provisioning never deletes', () => {
  // Deleting a Discord role takes its channel permission overwrites with it,
  // irreversibly — and the role that looks unused is the one holding access to
  // a channel nobody has opened this month. There is no flag for it, so there
  // is nothing to accidentally pass.
  it('has no DELETE anywhere, and no flag that could ask for one', () => {
    expect(CODE).not.toMatch(/method:\s*['"`]DELETE/i);
    expect(CODE).not.toMatch(/--delete|--prune|--clean/);
  });

  it('creates roles with NO permissions of their own', () => {
    // A role created with permissions grants them server-wide. Access is meant
    // to come from CHANNEL overwrites a human adds deliberately.
    expect(CODE).toMatch(/permissions:\s*['"`]0['"`]/);
    expect(CODE).not.toMatch(/hoist:\s*true/);
  });
});

describe('it plans by default and refuses a stale plan', () => {
  it('writes nothing without --apply', () => {
    expect(CODE).toMatch(/if \(!has\('--apply'\)\)/);
    // The early return must come BEFORE any write, or the flag is decorative.
    const gate = CODE.indexOf("has('--apply')");
    expect(gate).toBeGreaterThan(0);
    expect(CODE.indexOf("method: 'PATCH'")).toBeGreaterThan(gate);
    expect(CODE.indexOf("method: 'POST'")).toBeGreaterThan(gate);
  });

  it('requires the counts the operator read, and compares them', () => {
    // An --apply that recomputes and proceeds can do something nobody saw.
    expect(CODE).toMatch(/num\('--adopt'\) !== adopt\.length/);
    expect(CODE).toMatch(/num\('--create'\) !== create\.length/);
    expect(CODE).toMatch(/process\.exit\(1\)/);
  });
});

describe('the role cap is checked before anything is created', () => {
  // Discord refuses role 251 outright and refuses it PART WAY THROUGH a run,
  // leaving some nodes mapped and some not. Caught as an error it is a mess;
  // checked first it is a refusal.
  it('knows the cap and tests it ahead of the write loop', () => {
    expect(CODE).toMatch(/ROLE_CAP = 250/);
    const check = CODE.indexOf('after > ROLE_CAP');
    const firstWrite = CODE.indexOf("method: 'POST'");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstWrite);
  });
});

describe('a near match is never adopted automatically', () => {
  // Normalising away emoji and brackets is a heuristic, and a heuristic that
  // silently BINDS a role is how the wrong เหรัญญิก gets someone else's
  // channels. `near` is printed and then left alone.
  it('puts near matches in their own bucket and never writes them', () => {
    expect(CODE).toMatch(/near\.push/);
    const writes = [...CODE.matchAll(/for \(const \[?(\w+)/g)].map((m) => m[1]);
    expect(writes, 'only `adopt` and `create` may be iterated by the write loop')
      .not.toContain('near');
  });
});
