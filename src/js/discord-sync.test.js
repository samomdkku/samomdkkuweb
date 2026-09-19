// ==============================================
// discord-sync.test.js — the always-on sync (server/discord-sync*.mjs).
// Every action the owner listed (2026-09-19: rename, delete, remove, move,
// add/remove people) is a case here, plus the brakes that stop a mistake on
// the website from stripping Discord in bulk.
// ==============================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { diffMembers, gate, expectedRoleName, planProvision, serverPowers, formatReport } from '../../server/discord-sync-core.mjs';
import { serve, ROOT } from './discord-apply.fixture.js';
import { stripComments } from './strip-comments.js';

const R = (id, name, extra = {}) => ({ id, name, position: 5, permissions: '0', managed: false, ...extra });
const M = (id, roles, bot = false) => ({ user: { id, username: id, bot }, nick: null, roles });
const roles = [R('G', '@everyone', { position: 0 }), R('A', 'ฝ่าย A'), R('B', 'ฝ่าย B'), R('MOD', 'Moderator'),
  R('P', 'Power', { permissions: String(1n << 28n) })];
const managed = new Set(['A', 'B', 'P']);

describe('diffMembers — the website is the truth', () => {
  const base = { roles, managed, orphans: new Set() };
  it('adding a person to a ตำแหน่ง gives the key', () => {
    const d = diffMembers({ ...base, members: [M('u1', [])], targets: [{ discord_user_id: 'u1', role_ids: ['A'], placements: 1 }] });
    expect(d.adds.map((x) => x.role)).toEqual(['A']); expect(d.removes).toEqual([]);
  });
  it('moving them to another ตำแหน่ง swaps the key', () => {
    const d = diffMembers({ ...base, members: [M('u1', ['A'])], targets: [{ discord_user_id: 'u1', role_ids: ['B'], placements: 1 }] });
    expect(d.adds.map((x) => x.role)).toEqual(['B']); expect(d.removes.map((x) => x.role)).toEqual(['A']);
  });
  it('removing their last ตำแหน่ง takes every mirrored key — never an unmirrored one', () => {
    const d = diffMembers({ ...base, members: [M('u1', ['A', 'MOD'])], targets: [{ discord_user_id: 'u1', role_ids: [], placements: 0 }] });
    expect(d.removes.map((x) => x.role)).toEqual(['A']);
  });
  it('an account that UNLINKED loses its mirrored keys (0187)', () => {
    const d = diffMembers({ ...base, orphans: new Set(['u1']), members: [M('u1', ['A', 'MOD'])], targets: [{ discord_user_id: 'x', role_ids: [], placements: 1 }] });
    expect(d.removes.map((x) => x.role)).toEqual(['A']);
  });
  it('someone who NEVER linked is untouched — absence is unknown', () => {
    const d = diffMembers({ ...base, members: [M('stranger', ['A'])], targets: [{ discord_user_id: 'x', role_ids: [], placements: 1 }] });
    expect(d.adds).toEqual([]); expect(d.removes).toEqual([]);
  });
  it('a role deleted in Discord is reported, not recreated or crashed on', () => {
    const d = diffMembers({ ...base, members: [M('u1', [])], targets: [{ discord_user_id: 'u1', role_ids: ['GONE'], placements: 1 }] });
    expect(d.missing).toEqual(['GONE']); expect(d.adds).toEqual([]);
  });
  it('an event pass touches ONLY the people it names', () => {
    const d = diffMembers({ ...base, onlyDiscordIds: new Set(['u2']), members: [M('u1', []), M('u2', [])],
      targets: [{ discord_user_id: 'u1', role_ids: ['A'], placements: 1 }, { discord_user_id: 'u2', role_ids: ['B'], placements: 1 }] });
    expect(d.adds.map((x) => x.member)).toEqual(['u2']);
  });
});

describe('gate — the brakes', () => {
  const g = (diff, o = {}) => gate(diff, { roles, guildId: 'G', ...o });
  it('holds an unapproved POWER key, gives it once named', () => {
    const diff = { adds: [{ member: 'u', who: 'u', role: 'P' }], removes: [] };
    expect(g(diff).adds).toEqual([]); expect(g(diff).held[0].why).toMatch(/power key/);
    expect(g(diff, { allowPower: ['Power'] }).adds).toHaveLength(1);
  });
  it('a BULK removal is held for a human; the adds in the same batch still go', () => {
    const removes = Array.from({ length: 11 }, (_, i) => ({ member: `u${i}`, who: `u${i}`, role: 'A' }));
    const r = g({ adds: [{ member: 'z', who: 'z', role: 'B' }], removes });
    expect(r.removes).toEqual([]); expect(r.adds).toHaveLength(1); expect(r.held).toHaveLength(11);
  });
  it('a small removal goes through', () => {
    expect(g({ adds: [], removes: [{ member: 'u', who: 'u', role: 'A' }] }).removes).toHaveLength(1);
  });
  it('a role at or above the bot is held, never attempted', () => {
    expect(g({ adds: [{ member: 'u', who: 'u', role: 'A' }], removes: [] }, { botTop: 5 }).held[0].why).toMatch(/above the bot/);
  });
  it('serverPowers ignores what @everyone already has', () => {
    expect(serverPowers(R('x', 'x', { permissions: String(1n << 28n) }), { permissions: String(1n << 28n) })).toEqual([]);
  });
});

describe('renames and provisioning', () => {
  const nodes = [
    { id: 'top', name: 'ฝ่ายวิชาการ', parent_id: null, discord_role: true, discord_role_id: 'R1' },
    { id: 'rad', name: 'ฝ่ายรังสีเทคนิค', parent_id: null, discord_role: true, discord_role_id: 'R2' },
    { id: 'rad-a', name: 'ฝ่ายวิชาการ', parent_id: 'rad', discord_role: true, discord_role_id: null },
    { id: 'new', name: 'ฝ่ายใหม่', parent_id: null, discord_role: true, discord_role_id: null },
    { id: 'sec', name: 'ฝ่ายเลขานุการนายกฯ', parent_id: null, discord_role: true, discord_role_id: null },
  ];
  it('a renamed node\'s role takes the web name; a same-name sibling is qualified', () => {
    expect(expectedRoleName({ ...nodes[0], name: 'ฝ่ายวิชาการใหม่' }, nodes)).toBe('ฝ่ายวิชาการใหม่');
    expect(expectedRoleName(nodes[2], nodes)).toBe('ฝ่ายวิชาการ · รังสีเทคนิค');
  });
  it('ticking a node creates its role; an emoji look-alike is HELD, never duplicated', () => {
    const p = planProvision(nodes, [R('R1', 'ฝ่ายวิชาการ'), R('R2', 'ฝ่ายรังสีเทคนิค'), R('E', '📇 ฝ่ายเลขานุการนายกฯ')]);
    expect(p.create.map((c) => c.name).sort()).toEqual(['ฝ่ายวิชาการ · รังสีเทคนิค', 'ฝ่ายใหม่']);
    expect(p.held.map((h) => h.node.id)).toEqual(['sec']);
  });
  it('an unmapped role with exactly the name is adopted, not duplicated', () => {
    const p = planProvision(nodes, [R('R1', 'ฝ่ายวิชาการ'), R('R2', 'ฝ่ายรังสีเทคนิค'), R('N', 'ฝ่ายใหม่')]);
    expect(p.adopt.map((a) => a.role.id)).toEqual(['N']);
  });
  it('stops creating at the role cap', () => {
    const many = Array.from({ length: 245 }, (_, i) => R(`x${i}`, `r${i}`));
    expect(planProvision(nodes, many).create).toEqual([]);
  });
});

describe('the service never does anything outside its four write shapes', () => {
  const CODE = stripComments(readFileSync(join(ROOT, 'server', 'discord-sync.mjs'), 'utf8'));
  it('no role object is ever deleted, no channel is ever touched', () => {
    // `/guilds/${guildId}/roles/${id}` + DELETE is deleting the role OBJECT —
    // the channel overwrites die with it. A member's role (`/members/…/roles/…`)
    // is a key being taken back, which is the job.
    expect(CODE).not.toMatch(/\/guilds\/\$\{guildId\}\/roles\/\$\{[^}]+\}`,\s*\{\s*method:\s*'DELETE'/);
    expect(CODE).toMatch(/\/members\/\$\{r\.member\}\/roles\/\$\{r\.role\}`, \{ method: 'DELETE' \}/);
    expect(CODE).not.toMatch(/\/channels\//);
  });
  it('the service key reaches only these PostgREST paths', () => {
    const paths = [...CODE.matchAll(/pg\(\s*[`'"]([a-z_/]+)/g)].map((m) => m[1]).sort();
    expect([...new Set(paths)]).toEqual(['discord_orphaned_accounts', 'discord_sync_queue', 'rpc/discord_role_targets', 'team_nodes']);
  });
});

// ── One real pass of the real file against the stub guild ──────────────────
let w; let stub;
beforeEach(async () => {
  w = {
    guildId: 'G', botId: 'BOT',
    roles: [R('G', '@everyone', { position: 0 }), R('RA', 'ฝ่าย A'), R('RB', 'ฝ่าย B'), R('RP', 'Power', { permissions: String(1n << 28n) }),
      R('RBOT', 'bot', { position: 50, managed: true, permissions: String(1n << 28n) })],
    botRoles: ['RBOT'],
    members: [M('U1', ['RB']), M('U2', []), M('U3', ['RA']), M('BOT', ['RBOT'], true)],
    ticked: [
      { id: 'nA', name: 'ฝ่าย A', kind: 'division', parent_id: null, discord_role: true, discord_role_id: 'RA' },
      { id: 'nB', name: 'ฝ่าย B', kind: 'division', parent_id: null, discord_role: true, discord_role_id: 'RB' },
      { id: 'nP', name: 'Power', kind: 'role', parent_id: null, discord_role: true, discord_role_id: 'RP' },
      { id: 'nNew', name: 'ฝ่ายใหม่', kind: 'division', parent_id: null, discord_role: true, discord_role_id: null },
    ],
    targets: [
      { discord_user_id: 'U1', person_id: 'p1', role_ids: ['RA'], placements: 1 },   // moved B → A
      { discord_user_id: 'U2', person_id: 'p2', role_ids: ['RP'], placements: 1 },   // due a POWER key
    ],
    orphans: [{ discord_user_id: 'U3', person_id: 'p3', reason: 'unlinked-or-person-deleted', orphaned_at: '2026-09-19' }],
  };
  stub = await serve(w);
});
afterEach(async () => { await stub.close(); });

const once = (extra = {}) => new Promise((ok) => {
  const base = `http://127.0.0.1:${stub.port}`;
  execFile('node', [join(ROOT, 'server', 'discord-sync.mjs'), '--once'], { cwd: ROOT, env: { ...process.env,
    DISCORD_API_BASE: `${base}/api/v10`, DISCORD_TOKEN: 'stub', SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'stub',
    DISCORD_SYNC_WRITE_GAP_MS: '0', DISCORD_SYNC_LOG_WEBHOOK: `${base}/webhook`, ...extra } },
  (err, stdout, stderr) => ok({ code: err ? err.code ?? 1 : 0, out: stdout + stderr,
    writes: stub.requests.filter((r) => /^(PUT|DELETE|POST|PATCH) \/api\//.test(r)) }));
});

describe('one full pass, for real, against a stub guild', () => {
  it('moves U1 B→A, strips the unlinked U3, creates ฝ่ายใหม่, HOLDS U2\'s power key', async () => {
    const r = await once();
    expect(r.code, r.out).toBe(0);
    expect(r.writes.sort()).toEqual([
      'DELETE /api/v10/guilds/G/members/U1/roles/RB',
      'DELETE /api/v10/guilds/G/members/U3/roles/RA',
      'POST /api/v10/guilds/G/roles',
      'PUT /api/v10/guilds/G/members/U1/roles/RA',
    ]);
    expect(w.created[0]).toMatchObject({ name: 'ฝ่ายใหม่', permissions: '0', mentionable: false });
    expect(r.out).toMatch(/HELD U2: Power — power key/);
    // …and the channel got ONE silent report that pings nobody.
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0].flags).toBe(4096);
    expect(w.posted[0].allowed_mentions).toEqual({ parse: [] });
    expect(w.posted[0].content).toMatch(/<@U1> ได้ <@&RA> · ถูกเอาออก <@&RB>/);
    expect(w.posted[0].content).toMatch(/รอคนตรวจ[\s\S]*<@U2> <@&RP> — power key/);
  });
  it('with the power key approved, U2 gets it', async () => {
    const r = await once({ DISCORD_SYNC_ALLOW_POWER: 'Power' });
    expect(r.writes).toContain('PUT /api/v10/guilds/G/members/U2/roles/RP');
  });
  it('an EMPTY target set writes nothing at all', async () => {
    w.targets = [];
    const r = await once();
    expect(r.writes).toEqual([]);
    expect(r.out).toMatch(/NO rows/);
  });
});

describe('formatReport — what the role-bot channel reads', () => {
  const q = [{ actor_name: 'มุกโกะ (ภูสุดา) — x@kkumail.com', detail: 'ย้าย อั้ม จาก ฝ่าย A ไป ฝ่าย B' }];
  it('says who edited, what, and whose keys moved', () => {
    const [m] = formatReport({ queue: q, adds: [{ member: 'u1', role: 'B' }], removes: [{ member: 'u1', role: 'A' }] });
    expect(m).toMatch(/แก้โดย:\*\* มุกโกะ/);
    expect(m).toMatch(/• ย้าย อั้ม จาก ฝ่าย A ไป ฝ่าย B/);
    expect(m).toMatch(/• <@u1> ได้ <@&B> · ถูกเอาออก <@&A>/);
  });
  it('a change with no Discord effect posts NOTHING (e.g. the person never linked)', () => {
    expect(formatReport({ queue: q })).toEqual([]);
  });
  it('a full pass with no editor says it was the automatic check', () => {
    expect(formatReport({ full: true, adds: [{ member: 'u', role: 'A' }] })[0]).toMatch(/ตรวจรอบอัตโนมัติ/);
  });
  it('every message stays under Discord\'s 2000-character limit', () => {
    const adds = Array.from({ length: 200 }, (_, i) => ({ member: `1${String(i).padStart(17, '0')}`, role: '1'.repeat(19) }));
    const out = formatReport({ queue: q, adds });
    expect(out.length).toBeGreaterThan(1);
    for (const m of out) expect(m.length).toBeLessThanOrEqual(2000);
  });
});
