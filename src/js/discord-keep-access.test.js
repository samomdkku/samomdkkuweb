// ==============================================
// discord-keep-access.test.js — keys match the web, access does not move.
// ==============================================
import { describe, it, expect } from 'vitest';
import { planKeepAccess, simulate, sameAccess } from '../../tools/discord-keep-access.mjs';

const V = String(1n << 10n);
function world() {
  return {
    guild: 'G',
    roles: [
      { id: 'G', name: '@everyone', permissions: '0' },
      { id: 'OLD', name: 'ฝ่ายเก่า', permissions: '0' },       // mirrored, NOT due → extra
      { id: 'WEB', name: 'ฝ่ายจริง', permissions: '0' },       // mirrored, due
      { id: 'MOD', name: 'Moderator', permissions: '0' },      // not mirrored — never touched
      { id: 'SRV', name: 'ผู้ดูแล', permissions: String(1n << 1n) },  // mirrored, server-wide power
    ],
    channels: [
      { id: 'A', name: 'old-room', type: 0, parent_id: null, ow: [{ id: 'G', type: 0, allow: '0', deny: V }, { id: 'OLD', type: 0, allow: V, deny: '0' }] },
      { id: 'B', name: 'web-room', type: 0, parent_id: null, ow: [{ id: 'G', type: 0, allow: '0', deny: V }, { id: 'WEB', type: 0, allow: V, deny: '0' }] },
    ],
    members: [
      { id: 'p', display: 'p', roles: ['OLD', 'WEB', 'MOD'] },
      { id: 'q', display: 'q', roles: ['WEB'] },
    ],
  };
}
const targets = [
  { discord_user_id: 'p', role_ids: ['WEB'], placements: 1 },
  { discord_user_id: 'q', role_ids: ['WEB'], placements: 1 },
];
const mapped = new Set(['OLD', 'WEB', 'SRV']);

describe('planKeepAccess', () => {
  it('removes only the extra MIRRORED key and gives a personal pass for exactly what it opened', () => {
    const r = planKeepAccess(world(), targets, mapped);
    expect(r.removals.map((x) => `${x.member}-${x.role}`)).toEqual(['p-OLD']);
    expect(r.passes.map((x) => `${x.member}@${x.channel}=${x.allow}`)).toEqual([`p@A=${V}`]);
  });

  it('access is bit-for-bit unchanged for everyone, and the pass opens nothing to anyone else', () => {
    const w = world(); const r = planKeepAccess(w, targets, mapped);
    const after = simulate(w, r.passes, r.removals);
    expect(sameAccess(w, after).diff).toEqual([]);
    expect(after.members.find((m) => m.id === 'p').roles).toEqual(['WEB', 'MOD']);
  });

  it('CONTROL: removing the key WITHOUT the pass is caught as a loss', () => {
    const w = world(); const r = planKeepAccess(w, targets, mapped);
    expect(sameAccess(w, simulate(w, [], r.removals)).diff).toEqual(['p #old-room: LOST']);
  });

  it('CONTROL: giving the WEB key the room instead is caught — it opens it to q', () => {
    const w = world();
    const leaky = { ...w, channels: w.channels.map((c) => (c.id === 'A' ? { ...c, ow: [...c.ow, { id: 'WEB', type: 0, allow: V, deny: '0' }] } : c)) };
    expect(sameAccess(w, { ...leaky, members: w.members }).diff).toContain('q #old-room: GAINED');
  });

  it('refuses a key with server-wide powers — a channel pass cannot replace those', () => {
    const w = world(); w.members[0].roles.push('SRV');
    const r = planKeepAccess(w, targets, mapped);
    expect(r.refused[0]).toMatch(/ผู้ดูแล has server-wide permissions/);
    expect(r.removals).toEqual([]);
  });

  it('never judges an unlinked person or a leaver', () => {
    const w = world();
    expect(planKeepAccess(w, [{ discord_user_id: 'p', role_ids: [], placements: 0 }], mapped).removals).toEqual([]);
    expect(planKeepAccess(w, [], mapped).removals).toEqual([]);
  });
});
