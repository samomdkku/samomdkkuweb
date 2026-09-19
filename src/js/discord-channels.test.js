// ==============================================
// discord-channels.test.js — giving a ฝ่าย role its สมาชิก channels can never
// take anything from anyone, never breaks category sync, and never opens a
// SUB-team's channel to the whole ฝ่าย.
// ==============================================
import { describe, it, expect } from 'vitest';
import { planChannels, simulate, verify, effective } from '../../tools/discord-channels.mjs';

const VIEW = String(1n << 10n);
const VIEW_MANAGE = String((1n << 10n) | (1n << 4n));
const SEND = String(1n << 11n);

function world() {
  return {
    guild: 'G',
    roles: [
      { id: 'G', name: '@everyone', permissions: SEND },
      { id: 'RD', name: 'ฝ่าย X', permissions: '0' },
      { id: 'RM', name: 'สมาชิกฝ่าย X', permissions: '0' },
      { id: 'RH', name: 'หัวหน้าฝ่าย X', permissions: '0' },
      { id: 'RC', name: 'ฝ่าย Big', permissions: '0' },
      { id: 'RS', name: 'สมาชิกฝ่าย Sub', permissions: '0' },
    ],
    channels: [
      // a category and its SYNCED child, both opened to สมาชิกฝ่าย X
      { id: 'K', name: 'cat', type: 4, parent_id: null, ow: [{ id: 'G', type: 0, allow: '0', deny: VIEW }, { id: 'RM', type: 0, allow: VIEW, deny: SEND }] },
      { id: 'C1', name: 'x-chat', type: 0, parent_id: 'K', ow: [{ id: 'G', type: 0, allow: '0', deny: VIEW }, { id: 'RM', type: 0, allow: VIEW, deny: SEND }] },
      // head-only channel: must NOT be copied to the ฝ่าย role
      { id: 'C2', name: 'x-head', type: 0, parent_id: null, ow: [{ id: 'G', type: 0, allow: '0', deny: VIEW }, { id: 'RH', type: 0, allow: VIEW_MANAGE, deny: '0' }] },
      // a sub-team channel under ฝ่าย Big
      { id: 'C3', name: 'sub', type: 0, parent_id: null, ow: [{ id: 'G', type: 0, allow: '0', deny: VIEW }, { id: 'RS', type: 0, allow: VIEW, deny: '0' }] },
    ],
    members: [
      { id: 'head', display: 'head', roles: ['RD', 'RH'] },
      { id: 'mem', display: 'mem', roles: ['RD', 'RM'] },
      { id: 'big', display: 'big', roles: ['RC'] },
    ],
  };
}
const nodes = [
  { id: 'nD', name: 'ฝ่าย X', kind: 'division', parent_id: null, discord_role: true, discord_role_id: 'RD' },
  { id: 'nM', name: 'สมาชิกฝ่าย X', kind: 'role', parent_id: 'nD', discord_role: true, discord_role_id: 'RM' },
  { id: 'nH', name: 'หัวหน้าฝ่าย X', kind: 'role', parent_id: 'nD', discord_role: true, discord_role_id: 'RH' },
  { id: 'nC', name: 'ฝ่าย Big', kind: 'division', parent_id: null, discord_role: true, discord_role_id: 'RC' },
  { id: 'nS', name: 'สมาชิกฝ่าย Sub', kind: 'role', parent_id: 'nC', discord_role: true, discord_role_id: 'RS' },
];

describe('planChannels', () => {
  it('copies the สมาชิก role\'s ALLOW bits — never its deny — onto the ฝ่าย role', () => {
    const { writes } = planChannels(world(), nodes);
    expect(writes.map((w) => `${w.role}@${w.channel}`).sort()).toEqual(['RD@C1', 'RD@K']);
    for (const w of writes) { expect(w.allow).toBe(VIEW); expect(w.deny).toBe('0'); }
  });

  it('never copies a HEAD channel to the whole ฝ่าย', () => {
    expect(planChannels(world(), nodes).writes.some((w) => w.channel === 'C2')).toBe(false);
  });

  it('never opens a sub-team\'s member channel to the parent ฝ่าย', () => {
    const r = planChannels(world(), nodes);
    expect(r.writes.some((w) => w.role === 'RC')).toBe(false);
    expect(r.noSource).toContain('ฝ่าย Big');
  });

  it('is idempotent — a second plan over the result is empty', () => {
    const w = world();
    const after = simulate(w, planChannels(w, nodes).writes);
    expect(planChannels(after, nodes).writes).toEqual([]);
  });
});

describe('verify — the proof that gates --apply', () => {
  it('the planned writes lose nothing, keep sync, and the head gains the member channel', () => {
    const w = world();
    const v = verify(w, simulate(w, planChannels(w, nodes).writes));
    expect(v.lost).toEqual([]);
    expect(v.unsynced).toEqual([]);
    expect([...v.gained.get('x-chat')]).toEqual(['head']);
  });

  it('CONTROL: a copied DENY would be caught as a loss', () => {
    // If the tool ever copied `deny: SEND`, the head — who had SEND from
    // @everyone — would lose it on #x-chat. verify must see that.
    const w = world();
    const bad = planChannels(w, nodes).writes.map((x) => ({ ...x, deny: SEND }));
    expect(verify(w, simulate(w, bad)).lost).toContain('head #x-chat');
  });

  it('CONTROL: writing only the child and not its category is caught as broken sync', () => {
    const w = world();
    const half = planChannels(w, nodes).writes.filter((x) => x.channel === 'C1');
    expect(verify(w, simulate(w, half)).unsynced).toEqual(['C1']);
  });

  it('effective() applies role denies before role allows (allow wins between roles)', () => {
    const w = world();
    const rolesById = new Map(w.roles.map((r) => [r.id, r]));
    const ch = { ow: [{ id: 'RM', type: 0, allow: '0', deny: VIEW }, { id: 'RD', type: 0, allow: VIEW, deny: '0' }] };
    expect(effective('G', 'mem', ['RD', 'RM'], ch, rolesById) & (1n << 10n)).toBe(1n << 10n);
  });
});
