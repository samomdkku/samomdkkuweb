// ==============================================
// discord-provision.run.test.js — provisioning RUN against a stub guild.
//
// The CREATE branch has never run against the real guild: every provisioning
// run until 2026-09-19 was --adopt-only. It already shipped one defect nobody
// could see (a Thai X-Audit-Log-Reason header that made fetch throw before any
// request existed), so the first real create must not also be the first run.
//
// What is asserted is what comes OUT: the exact names roles are created with
// and which ทีม SAMO node each new role id is written to. The name is the part
// a regex over the source cannot check — §5b's qualified names
// (`ฝ่ายวิชาการ · รังสีเทคนิค`) are computed.
// ==============================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { serve, run, world } from './discord-apply.fixture.js';

// The shape of the real ฝ่ายวิชาการ problem: three nodes with one name, one of
// which (the top-level, after the 2026-09-19 fix) holds the Discord role. Plus
// a look-alike (`ฝ่าย COMART` vs an existing `ฝ่าย ComArt (…)`) the owner said
// is a SEPARATE team, and one plain new ฝ่าย.
function provisionWorld() {
  const w = world();
  w.roles = [
    { id: 'E', name: '@everyone', position: 0, permissions: '0', managed: false },
    { id: 'RA', name: 'ฝ่ายวิชาการ', position: 5, permissions: '0', managed: false },
    { id: 'RC', name: 'ฝ่าย ComArt (Communication Art)', position: 6, permissions: '0', managed: false },
    { id: 'RB', name: 'samo-sync', position: 50, permissions: '268435456', managed: true },
  ];
  w.ticked = [
    { id: 'top', name: 'ฝ่ายวิชาการ', parent_id: null, discord_role: true, discord_role_id: 'RA' },
    { id: 'rad', name: 'ฝ่ายรังสีเทคนิค', parent_id: null, discord_role: true, discord_role_id: null },
    { id: 'vet', name: 'ฝ่ายเวชนิทัศน์', parent_id: null, discord_role: true, discord_role_id: null },
    { id: 'rad-a', name: 'ฝ่ายวิชาการ', parent_id: 'rad', discord_role: true, discord_role_id: null },
    { id: 'vet-a', name: 'ฝ่ายวิชาการ', parent_id: 'vet', discord_role: true, discord_role_id: null },
    { id: 'vet-c', name: 'ฝ่าย COMART', parent_id: 'vet', discord_role: true, discord_role_id: null },
    { id: 'off', name: 'สมาชิก', parent_id: 'vet', discord_role: false, discord_role_id: null },
  ];
  return w;
}

let w; let stub;
beforeEach(async () => { w = provisionWorld(); stub = await serve(w); });
afterEach(async () => { await stub.close(); });

const provision = (args) => run(args, stub, {}, 'discord-provision.mjs');

describe('same-name ฝ่าย get a qualified role of their own', () => {
  it('plans, and writes nothing without --apply', async () => {
    const r = await provision([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('"ฝ่ายวิชาการ"  →  new role "ฝ่ายวิชาการ · รังสีเทคนิค"');
    expect(r.out).toContain('"ฝ่ายวิชาการ"  →  new role "ฝ่ายวิชาการ · เวชนิทัศน์"');
    // Without --create-near the look-alike stays a human's decision.
    expect(r.out).toMatch(/NEAR\s+1/);
    expect(w.created).toBeUndefined();
    expect(w.patched).toBeUndefined();
  });

  it('creates exactly the planned roles, by name, and maps each to ITS node', async () => {
    const r = await provision(['--apply', '--adopt', '0', '--create', '5', '--create-near', 'ฝ่าย COMART']);
    expect(r.code, r.out).toBe(0);
    expect(w.created.map((c) => c.name).sort()).toEqual([
      'ฝ่าย COMART · เวชนิทัศน์',
      'ฝ่ายรังสีเทคนิค',
      'ฝ่ายวิชาการ · รังสีเทคนิค',
      'ฝ่ายวิชาการ · เวชนิทัศน์',
      'ฝ่ายเวชนิทัศน์',
    ]);
    // No permissions of its own, and a header fetch can actually send.
    for (const c of w.created) {
      expect(c.permissions).toBe('0');
      expect(c.auditReason).toMatch(/^[\x20-\x7e]+$/);
    }
    // Each new role id lands on the node it was created for — never the
    // top-level ฝ่ายวิชาการ, which already holds RA.
    const byName = Object.fromEntries(w.created.map((c, i) => [c.name, `NEW${i + 1}`]));
    const got = Object.fromEntries(w.patched.map((p) => [p.id, p.discord_role_id]));
    expect(got).toEqual({
      'rad-a': byName['ฝ่ายวิชาการ · รังสีเทคนิค'],
      'vet-a': byName['ฝ่ายวิชาการ · เวชนิทัศน์'],
      'vet-c': byName['ฝ่าย COMART · เวชนิทัศน์'],
      rad: byName['ฝ่ายรังสีเทคนิค'],
      vet: byName['ฝ่ายเวชนิทัศน์'],
    });
    expect(got).not.toHaveProperty('top');
  });

  it('refuses a stale count and writes nothing', async () => {
    // The plan without --create-near is 4; 3 is stale.
    const r = await provision(['--apply', '--adopt', '0', '--create', '3']);
    expect(r.code).not.toBe(0);
    expect(w.created).toBeUndefined();
    expect(w.patched).toBeUndefined();
  });

  it('an UNSETTLED contest over an existing role is left to a human', async () => {
    w.ticked[0].discord_role_id = null;   // nobody holds ฝ่ายวิชาการ yet
    const r = await provision([]);
    expect(r.out).toMatch(/CONTESTED 3/);
    expect(r.out).not.toContain('→  new role "ฝ่ายวิชาการ');
  });

  it('--create-near naming something not ticked REFUSES', async () => {
    const r = await provision(['--create-near', 'ฝ่ายไม่มีจริง']);
    expect(r.code).not.toBe(0);
    expect(w.created).toBeUndefined();
  });
});

describe('an emoji-prefixed Discord role is still recognised', () => {
  it('`📇 ฝ่ายX` is a NEAR match for web `ฝ่ายX` — never a second, empty role', async () => {
    // 2026-09-19: the emoji was stripped but its trailing space kept, so the
    // ฝ่าย prefix did not strip and the names normalised apart — a duplicate
    // of `📇 ฝ่ายเลขานุการนายกฯ` was created. It must land in NEAR instead.
    w.roles.push({ id: 'RE', name: '📇 ฝ่ายเลขานุการนายกฯ', position: 7, permissions: '0', managed: false });
    w.ticked.push({ id: 'sec', name: 'ฝ่ายเลขานุการนายกฯ', parent_id: null, discord_role: true, discord_role_id: null });
    const r = await provision([]);
    expect(r.out).toContain('"ฝ่ายเลขานุการนายกฯ"  ≈  "📇 ฝ่ายเลขานุการนายกฯ"');
    expect(r.out).not.toContain('→  new role "ฝ่ายเลขานุการนายกฯ');
  });
});
