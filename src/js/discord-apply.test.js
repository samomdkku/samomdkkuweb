// ==============================================
// discord-apply.test.js — the five things the APPLY step must never do.
//
// This is the only tool in the Discord work that removes access from a real
// person, so every safety property docs/DISCORD-ROLE-SYNC.md §5e states in
// prose is asserted here. The report gets "writes nothing" for free by having
// no verb but GET; provisioning gets "never deletes" by having no DELETE.
// Neither guarantee is available to this file — it has to write, and it has to
// delete — so what is guarded instead is WHICH write, and WHEN.
//
// ⛔ Each assertion below is one the tool was watched FAILING before it passed:
// the ritual in .claude/rules/mistakes.md class 7. A guard nobody has seen go
// red is a guard nobody knows the polarity of.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = readFileSync(join(ROOT, 'tools', 'discord-apply.mjs'), 'utf8');
// ⛔ Comments are stripped before any assertion. This file's comments talk about
// DELETE, role objects and stripping members at length; a detector reading them
// would be satisfied by prose, which is how confirm-modal.test.js came to match
// a comment instead of a call.
const CODE = stripComments(RAW);

/** Every line that issues a mutating Discord call. */
const discordWrites = (src) => src.split('\n')
  .filter((l) => /\bdc\(/.test(l) && /method:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(l));

describe('the instrument read the real file', () => {
  it('found source, not an empty or mangled string', () => {
    expect(CODE.length).toBeGreaterThan(3000);
    expect(CODE).toContain('discord.com/api');
    expect(CODE).toContain('discord_role_targets');
  });

  // THE CONTROL. Without it a detector that matches nothing reports a clean
  // sweep for ever and this file becomes decoration.
  it('its detector would catch a role-object delete', () => {
    const bad = "await dc(`/guilds/${g}/roles/${id}`, { method: 'DELETE' });";
    expect(discordWrites(bad)).toHaveLength(1);
    expect(discordWrites(bad)[0]).not.toContain('MEMBER_ROLE(');
    expect(discordWrites('await dc(`/guilds/${g}/roles`);')).toHaveLength(0);
  });
});

describe('it can only ever touch one member’s one role', () => {
  // Deleting a Discord ROLE takes its channel permission overwrites with it,
  // irreversibly, and the role that looks unused is the one gating a channel
  // nobody has opened this month. The guarantee is structural: there is exactly
  // one path template, and every mutating call uses it.
  it('every mutating Discord call goes through MEMBER_ROLE()', () => {
    const writes = discordWrites(CODE);
    expect(writes.length, 'expected the PUT and the DELETE').toBeGreaterThanOrEqual(2);
    for (const line of writes) {
      expect(line, `a mutating call on a path that is not one member's one role:\n${line}`)
        .toContain('MEMBER_ROLE(');
    }
  });

  it('MEMBER_ROLE is a member-scoped path and nothing else', () => {
    expect(CODE).toMatch(/const MEMBER_ROLE = \(g, u, r\) => `\/guilds\/\$\{g\}\/members\/\$\{u\}\/roles\/\$\{r\}`/);
  });

  it('has no flag that could ask for a deletion or a purge', () => {
    expect(CODE).not.toMatch(/--delete|--prune|--clean|--wipe/);
  });

  it('writes nothing to the database — the portal is the source of truth', () => {
    const dbWrites = CODE.split('\n')
      .filter((l) => /\bpg\(/.test(l) && /method:\s*['"`](PUT|PATCH|DELETE)/i.test(l));
    expect(dbWrites, 'a sync that edits ทีม SAMO is a sync writing to its own input').toEqual([]);
  });
});

describe('it plans by default', () => {
  it('returns before the first write without --apply', () => {
    expect(CODE).toMatch(/if \(!has\('--apply'\)\)/);
    const gate = CODE.indexOf("has('--apply')");
    expect(gate).toBeGreaterThan(0);
    expect(CODE.indexOf("method: 'PUT'")).toBeGreaterThan(gate);
    expect(CODE.indexOf("method: 'DELETE'")).toBeGreaterThan(gate);
  });

  it('requires the counts the operator read, and compares them to a FRESH diff', () => {
    // An --apply that recomputes and proceeds silently can do something nobody
    // ever saw. The plan is recomputed on every invocation; these are what make
    // the recomputation a refusal rather than a surprise.
    expect(CODE).toMatch(/num\('--add'\) !== add \|\| num\('--remove'\) !== remove/);
    expect(CODE).toMatch(/process\.exit\(1\)/);
  });
});

describe('§5e — the three refusals, all of them before the first write', () => {
  const firstWrite = () => Math.min(
    ...[CODE.indexOf("method: 'PUT'"), CODE.indexOf("method: 'DELETE'")].filter((i) => i > 0),
  );

  // An empty target set is NOT a diff. discord_role_targets() is SECURITY
  // INVOKER, so "no rows" is equally "nobody is linked" and "this credential
  // cannot see team_nodes" — and to a reconcile both read as "remove every
  // mirrored role from everybody". Class 2, exactly.
  it('refuses an empty target set', () => {
    expect(CODE).toMatch(/if \(!targets\.length\)/);
    const refusal = CODE.indexOf('!targets.length');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(firstWrite());
  });

  // Never act on absence. A guild member with no link is UNKNOWN, never
  // "entitled to nothing" — they must not reach the plan at all.
  it('skips an unlinked member instead of diffing them against nothing', () => {
    expect(CODE).toMatch(/const t = byUser\.get\(m\.user\.id\);\s*\n\s*if \(!t\) continue;/);
  });

  // A person with zero placements is the leaver case, and §5e wants them to
  // keep a ศิษย์เก่า SAMO role rather than be stripped bare. Both "what makes a
  // leaver" and that role are the owner's undecided call, so the tool reports
  // and touches nothing.
  it('never strips a leaver while the rule is undecided', () => {
    expect(CODE).toMatch(/if \(t\.placements === 0\) \{/);
    const leaver = CODE.indexOf('t.placements === 0');
    expect(CODE.slice(leaver, leaver + 400)).toMatch(/continue;/);
    expect(CODE.slice(leaver, leaver + 400)).not.toMatch(/toRemove|method:/);
  });

  it('has a blast-radius cap with named numbers, checked before the write loop', () => {
    expect(CODE).toMatch(/const MAX_REMOVALS = \d+/);
    expect(CODE).toMatch(/const MAX_PERCENT = \d+/);
    const check = CODE.indexOf('remove > MAX_REMOVALS');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstWrite());
    // …and over the cap it must REFUSE rather than warn.
    expect(CODE).toMatch(/oversized && !has\('--allow-large'\)/);
  });

  it('can only touch roles the managed mapping owns', () => {
    // The managed set is DERIVED from node → role (§5d), never a name prefix
    // and never an exclusion list, which cannot see the role added next month.
    expect(CODE).toMatch(/managed = new Set\(ticked\.map\(\(t\) => t\.discord_role_id\)/);
    const stray = CODE.indexOf('const stray');
    expect(stray).toBeGreaterThan(0);
    expect(stray).toBeLessThan(firstWrite());
  });
});

describe('the step that fails silently is checked, not trusted', () => {
  // A bot can only manage roles BELOW its own highest role. Administrator does
  // NOT exempt it — only the guild owner is exempt — and Discord answers 204
  // and changes nothing. §7 step 4 is the drag that fixes it; a run that
  // "succeeded" while changing nothing is the failure it exists to prevent.
  it('compares the bot’s position against the roles the plan would touch', () => {
    expect(CODE).toMatch(/function hierarchy\(botMember, roles, touchedIds\)/);
    expect(CODE).toMatch(/r\.position >= top/);
  });

  it('refuses on a role above the bot, and on a missing Manage Roles', () => {
    const firstWrite = CODE.indexOf("method: 'PUT'");
    const aboveRefusal = CODE.indexOf('h.above.length) {\n    console.error');
    expect(CODE).toMatch(/if \(!h\.canManage\) \{/);
    expect(aboveRefusal).toBeGreaterThan(0);
    expect(aboveRefusal).toBeLessThan(firstWrite);
  });

  // Administrator implies Manage Roles but is not a substitute for the drag —
  // if this ever becomes "administrator means skip the check", the tool starts
  // reporting successful runs that change nothing.
  it('does not let Administrator skip the hierarchy check', () => {
    const h = CODE.slice(CODE.indexOf('function hierarchy'), CODE.indexOf('async function main'));
    expect(h).toMatch(/ADMINISTRATOR/);            // it counts toward canManage
    const above = h.slice(h.indexOf('const above'));
    expect(above).not.toMatch(/ADMINISTRATOR/);    // …and never toward `above`
  });
});

describe('it never copies the credential it needs', () => {
  it('says the token stays on the VM', () => {
    expect(RAW).toMatch(/Do not copy the Discord token to a laptop/);
    expect(RAW).toMatch(/leaked this credential three times/);
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

describe('the API base is overridable ONLY to loopback', () => {
  // The override exists so discord-apply.run.test.js can point the real tool at
  // a stub. But this process holds the bot token, so an env var that could
  // redirect it to an arbitrary host is a credential-exfiltration path — for a
  // token this project has already lost three times, every leak a copy in
  // transit. The restriction is the reason the override is acceptable at all.
  const ALLOW = /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/;

  it('the file restricts it, and does not simply read the env var', () => {
    expect(CODE).toMatch(/process\.env\.DISCORD_API_BASE/);
    expect(CODE).toContain(String(ALLOW).slice(1, -1));
    expect(CODE).toMatch(/'https:\/\/discord\.com\/api\/v10'/);
  });

  it('its pattern admits a loopback stub and refuses everything else', () => {
    expect(ALLOW.test('http://127.0.0.1:54321/api/v10')).toBe(true);
    expect(ALLOW.test('https://discord.com/api/v10')).toBe(false);
    expect(ALLOW.test('http://evil.example.com/api/v10')).toBe(false);
    // The two that look like loopback and are not.
    expect(ALLOW.test('http://127.0.0.1.evil.com/api/v10')).toBe(false);
    expect(ALLOW.test('http://127.0.0.1:80@evil.com/api/v10')).toBe(false);
  });
});
