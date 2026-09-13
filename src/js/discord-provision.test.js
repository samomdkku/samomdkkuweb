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
    // Compared against what WILL be created, not against the full create list —
    // --adopt-only makes those two different numbers, and comparing the wrong
    // one would refuse every correct adopt-only run.
    expect(CODE).toMatch(/num\('--create'\) !== willCreate\.length/);
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
    expect(writes, 'only `adopt` and `willCreate` may be iterated by the write loop')
      .not.toContain('near');
  });

  // --adopt-only is the recommended path, so the thing that makes it SAFE —
  // that it creates nothing — is worth pinning rather than trusting.
  it('--adopt-only creates nothing, and the cap maths follows it', () => {
    expect(CODE).toMatch(/const willCreate = adoptOnly \? \[\] : create;/);
    expect(CODE).toMatch(/has\('--adopt-only'\) \? 0 : create\.length/);
  });
});

describe('the cap counts every role Discord counts', () => {
  // Discord's 250 limit counts EVERY role in the guild — @everyone and
  // integration-managed roles included. This tool filters those out to decide
  // what it may ADOPT, and the cap maths used the filtered list plus one,
  // silently dropping the managed roles: 3 on this server, reported as 231 of
  // 250 where the truth is 234. Harmless at 92% and exactly wrong at the wall,
  // because Discord refuses role 251 part way through a run.
  it('measures the cap against the UNFILTERED role list', () => {
    expect(CODE).toMatch(/const allRoles = await dc\(`\/guilds\/\$\{guildId\}\/roles`\);/);
    expect(CODE).toMatch(/const after = allRoles\.length \+/);
    expect(CODE, 'the cap must not be computed from the adoptable subset')
      .not.toMatch(/const after = roles\.length/);
  });

  it('…and still adopts only from the filtered one', () => {
    // The filter is still right for its own job: a managed role belongs to an
    // integration and cannot be assigned by anybody, so it is not a candidate.
    expect(CODE).toMatch(/const roles = allRoles\.filter\(\(r\) => r\.name !== '@everyone' && !r\.managed\)/);
  });
});

describe('a header value is latin-1, and every reason here is Thai', () => {
  // A non-ASCII HTTP header value makes fetch() throw
  // `Cannot convert argument to a ByteString` BEFORE the request is built, so
  // the write does not fail — it never happens. Both Discord tools set
  // X-Audit-Log-Reason to a Thai string, and both were shipped raw.
  //
  // Asserted as a PROPERTY over every header in the file, not as a check of the
  // one call site that exists today: a second audit reason added later must
  // also be encoded, and a list of call sites cannot see the next one.
  it('no header value in this file contains a non-ASCII literal', () => {
    const headers = [...CODE.matchAll(/'X-Audit-Log-Reason':\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    expect(headers.length, 'read no audit reason at all — the detector is blind').toBeGreaterThan(0);
    for (const h of headers) {
      expect(h, `an audit reason that is not URL-encoded will throw before the request:\n  ${h}`)
        .toMatch(/^encodeURIComponent\(/);
    }
  });

  it('…and its detector would catch a raw one', () => {
    const raw = "headers: { 'X-Audit-Log-Reason': 'ทีม SAMO role sync' },";
    const found = [...raw.matchAll(/'X-Audit-Log-Reason':\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    expect(found).toHaveLength(1);
    expect(found[0]).not.toMatch(/^encodeURIComponent\(/);
  });
});
