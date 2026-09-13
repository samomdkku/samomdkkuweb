// ==============================================
// discord-readiness.test.js — the readiness report asks, it never tells.
//
// It runs SQL against PRODUCTION by default (tools/db-query and env-lib both
// resolve to the live project unless told otherwise — HANDOFF §9), so "it only
// reads" has to be a property of the file rather than an intention. And it must
// need no Discord token: the whole point is that it runs on a laptop, and a
// version that reached for the token would push it onto the machine that holds
// the database — the move that leaked that credential three times.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = readFileSync(join(ROOT, 'tools', 'discord-readiness.mjs'), 'utf8');
// Its comments discuss writing, tokens and the guild at length; a detector
// reading them would be satisfied by prose.
const CODE = stripComments(RAW);

const WRITES = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+|alter\s+|truncate)\b/i;

describe('it reads and nothing else', () => {
  it('read the real file', () => {
    expect(CODE.length).toBeGreaterThan(1500);
    expect(CODE).toContain('team_members');
    expect(CODE).toContain('discord_node_ancestry');
  });

  // THE CONTROL — without it a pattern that matches nothing passes for ever.
  it('its detector would catch a write', () => {
    expect(WRITES.test('insert into public.team_nodes values (1)')).toBe(true);
    expect(WRITES.test('update team_members set node_id = x')).toBe(true);
    expect(WRITES.test('delete from public.discord_links')).toBe(true);
    expect(WRITES.test('select count(*) from public.team_members')).toBe(false);
  });

  it('contains no SQL that changes anything', () => {
    expect(WRITES.test(CODE),
      'tools/discord-readiness.mjs has gained a write. It runs against PRODUCTION '
      + 'by default; a measurement that can mutate is not a measurement.').toBe(false);
  });
});

describe('it needs no Discord credential', () => {
  // The two credentials live on different machines on purpose. This tool exists
  // to be runnable where the database is, which is the machine the token must
  // never reach.
  it('never mentions the token or the Discord API', () => {
    expect(CODE).not.toMatch(/DISCORD_TOKEN|discord\.com\/api|Authorization/);
  });

  it('says so, so nobody "completes" it by adding the guild half', () => {
    expect(RAW).toMatch(/NEEDS NO DISCORD TOKEN/);
    expect(RAW).toMatch(/discord:report/);
  });
});

describe('it counts people, not just nodes', () => {
  // "59 ตำแหน่ง unprovisioned" and "219 people would be short a role" are the
  // same fact, and only one of them is an argument. The blocker list is ordered
  // by how many people sit beneath each, not by how much work each is.
  it('orders the blocker list by people beneath', () => {
    expect(CODE).toMatch(/order by beneath desc/);
    expect(CODE).toMatch(/discord_node_ancestry\(tm2\.node_id\)/);
  });

  it('reports the would-get-nothing case separately from being short one', () => {
    // Someone owed three roles who gets two is inconvenienced. Someone who gets
    // zero has been told it worked and received nothing, and will report the
    // bot as broken. They are different numbers and both are printed.
    expect(CODE).toMatch(/gettable = 0 and missing > 0/);
    expect(CODE).toMatch(/gettable > 0/);
  });
});
