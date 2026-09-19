// ==============================================
// discord-apply.fixture.js — a stub Discord + PostgREST, so the apply tool's
// WRITE PATH can be exercised without a guild, a token, or a real person.
//
// WHY THIS EXISTS. `discord-apply.test.js` reads the source and asserts things
// about its text: that the only mutable path is MEMBER_ROLE(), that the cap is
// checked before the write loop, that a leaver's branch contains no removal.
// Every one of those is a guard on the SHAPE of the file, and none of them can
// see the bug that actually costs someone their roles — a swapped member id, an
// add issued as a remove, a refusal that prints and then falls through, a cap
// computed over the wrong denominator. A source guard cannot catch a
// transposition, because the transposed code has the same shape.
//
// So this runs the real tool as a real child process against a server that
// answers like Discord and like PostgREST, and RECORDS EVERY REQUEST. The
// assertions are then about what came OUT, which is the thing that matters.
//
// ⛔ IT IS NOT A MODEL OF DISCORD, and must not grow into one. It answers the
// six GETs this tool makes and accepts the two writes, and its value is that
// the list of requests is exact: anything the tool sends that is not in the
// expected list is a failure, so a new call cannot appear unnoticed.
// ==============================================
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');

/** The default world: 5 humans, 2 mirrored roles, 1 unmanaged, 1 bot role. */
export function world() {
  return {
    guildId: 'G',
    botId: 'BOT',
    roles: [
      { id: 'E', name: '@everyone', position: 0, permissions: '0', managed: false },
      { id: 'R1', name: 'ฝ่าย IT', position: 5, permissions: '0', managed: false },
      { id: 'R2', name: 'ฝ่ายเอกสาร', position: 6, permissions: '0', managed: false },
      { id: 'R9', name: 'Moderator', position: 7, permissions: '0', managed: false },
      // 1 << 28 = MANAGE_ROLES. Position 50 is above everything it manages.
      { id: 'RB', name: 'samo-sync', position: 50, permissions: '268435456', managed: true },
    ],
    botRoles: ['RB'],
    members: [
      // alice — the only diff: due ฝ่าย IT, holds ฝ่ายเอกสาร plus an UNMANAGED
      // role that must survive untouched.
      { user: { id: 'U1', username: 'alice' }, nick: 'alice', roles: ['R2', 'R9'] },
      { user: { id: 'U2', username: 'bob' }, nick: null, roles: ['R1'] },
      // carol is NOT linked, and holds a managed role. Absence is UNKNOWN.
      { user: { id: 'U3', username: 'carol' }, nick: null, roles: ['R1', 'R9'] },
      // dave is linked with ZERO placements — the leaver case — and holds a
      // managed role. §5e: reported, never stripped.
      { user: { id: 'U4', username: 'dave' }, nick: null, roles: ['R2'] },
      { user: { id: 'U5', username: 'erin' }, nick: null, roles: [] },
      // frank unlinked, and still holds ฝ่าย IT.
      { user: { id: 'U6', username: 'frank' }, nick: null, roles: ['R1'] },
      { user: { id: 'BOT', username: 'stub', bot: true }, nick: null, roles: ['RB'] },
    ],
    ticked: [
      { id: 'n1', name: 'ฝ่าย IT', discord_role_id: 'R1' },
      { id: 'n2', name: 'ฝ่ายเอกสาร', discord_role_id: 'R2' },
      { id: 'n3', name: 'ฝ่ายใหม่', discord_role_id: null },
    ],
    // 0187: accounts that WERE linked and are not now. `frank` holds a mirrored
    // role and appears in NO target row — before 0187 that was indistinguishable
    // from a stranger, which is what made unlinking a permanent role grant.
    orphans: [
      { discord_user_id: 'U6', person_id: 'p6', reason: 'unlinked-or-person-deleted', orphaned_at: '2026-09-01T00:00:00Z' },
    ],
    targets: [
      { discord_user_id: 'U1', person_id: 'p1', role_ids: ['R1'], role_names: ['ฝ่าย IT'], pending: [], placements: 1 },
      { discord_user_id: 'U2', person_id: 'p2', role_ids: ['R1'], role_names: ['ฝ่าย IT'], pending: [], placements: 1 },
      { discord_user_id: 'U4', person_id: 'p4', role_ids: [], role_names: [], pending: [], placements: 0 },
    ],
  };
}

/** Start the stub. Returns { port, requests, close }. */
export function serve(w) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    requests.push(`${req.method} ${p}`);
    const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

    // ── Discord ──
    if (p === '/api/v10/users/@me/guilds') return json([{ id: w.guildId, name: 'stub guild' }]);
    if (p === '/api/v10/users/@me') return json({ id: w.botId, username: 'stub' });
    // discord-provision.mjs's only Discord write: create a role. The BODY is
    // kept, because the name a role is created with is the thing under test.
    if (req.method === 'POST' && p === `/api/v10/guilds/${w.guildId}/roles`) {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const body = JSON.parse(b);
        (w.created ||= []).push({ ...body, auditReason: req.headers['x-audit-log-reason'] });
        json({ id: `NEW${w.created.length}`, ...body });
      });
      return undefined;
    }
    if (p === `/api/v10/guilds/${w.guildId}/roles`) return json(w.roles);
    if (p === `/api/v10/guilds/${w.guildId}/members/${w.botId}`) {
      return json({ user: { id: w.botId, bot: true }, roles: w.botRoles });
    }
    if (p === `/api/v10/guilds/${w.guildId}/members`) {
      return json(url.searchParams.get('after') === '0' ? w.members : []);
    }
    // The write. Accepted, recorded, and nothing else.
    if (/^\/api\/v10\/guilds\/[^/]+\/members\/[^/]+\/roles\/[^/]+$/.test(p)) {
      res.writeHead(204); return res.end();
    }

    // ── PostgREST ──
    if (req.method === 'PATCH' && p === '/rest/v1/team_nodes') {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        (w.patched ||= []).push({ id: (url.searchParams.get('id') || '').replace(/^eq\./, ''), ...JSON.parse(b) });
        json([]);
      });
      return undefined;
    }
    if (p === '/rest/v1/team_nodes') return json(w.ticked);
    if (p === '/rest/v1/rpc/discord_role_targets') return json(w.targets);
    if (p === '/rest/v1/discord_orphaned_accounts') return json(w.orphans);

    res.writeHead(404); res.end(`no stub route for ${req.method} ${p}`);
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({
      port: server.address().port,
      requests,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

/** Run the real tool against the stub. Resolves { code, out, requests }. */
export function run(args, stub, extraEnv = {}, tool = 'discord-apply.mjs') {
  const base = `http://127.0.0.1:${stub.port}`;
  return new Promise((ok) => {
    execFile('node', [join(ROOT, 'tools', tool), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        DISCORD_API_BASE: `${base}/api/v10`,
        DISCORD_TOKEN: 'stub-token-not-a-real-credential',
        SUPABASE_URL: base,
        SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
        ...extraEnv,
      },
    }, (err, stdout, stderr) => ok({
      code: err ? (err.code ?? 1) : 0,
      out: `${stdout}\n${stderr}`,
      writes: stub.requests.filter((r) => /^(PUT|DELETE|POST|PATCH) \/api\//.test(r)),
    }));
  });
}
