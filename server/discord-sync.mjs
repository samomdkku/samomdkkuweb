#!/usr/bin/env node
// ============================================================
// discord-sync.mjs — ทีม SAMO → Discord, continuously (DISCORD-ROLE-SYNC §5f).
//
// Runs on the VM under systemd (server/samo-discord-sync.service). Every few
// seconds it drains public.discord_sync_queue (0197, filled by triggers on
// team_members / team_nodes / discord_links) and brings the affected people in
// line; every FULL_MS it does a full pass anyway, because an event stream
// drops things and people also edit Discord by hand.
//
// All decisions are in discord-sync-core.mjs and discord_role_targets(). This
// file only fetches, gates and writes — and every write is one of five shapes:
//   PUT/DELETE a member's role · POST a role (provisioning) · PATCH a role's NAME
//   · PATCH a member's NICKNAME (0207 — only with DISCORD_SYNC_NICKNAMES=apply)
// It never deletes a role object and never touches a channel.
//
// ⛔ BRAKES, always on: a bulk removal is held and reported, never applied
// (adds in the same batch still go); a key with server-wide power is given only
// if named in DISCORD_SYNC_ALLOW_POWER; a role at/above the bot is skipped and
// reported; an EMPTY target set never counts as "everyone is due nothing".
// ⛔ RATE LIMITS: one request at a time, a floor between writes, Discord's
// Retry-After honoured (per-route and global).
//
//   node server/discord-sync.mjs          # the service loop
//   node server/discord-sync.mjs --once   # one full pass, then exit (tests, ops)
//   node server/discord-sync.mjs --once --nick-plan   # print the nickname plan, write NO name
// ============================================================
import { diffMembers, gate, expectedRoleName, planProvision, formatReport, planNicknames } from './discord-sync-core.mjs';

const env = process.env;
const API = (() => {
  const o = env.DISCORD_API_BASE;
  return o && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(o) ? o : 'https://discord.com/api/v10';
})();
const POLL_MS = Number(env.DISCORD_SYNC_POLL_MS) || 5000;
const FULL_MS = Number(env.DISCORD_SYNC_FULL_MS) || 15 * 60 * 1000;
const WRITE_GAP_MS = Number(env.DISCORD_SYNC_WRITE_GAP_MS ?? 350);
const BACKOFF_MS = Number(env.DISCORD_SYNC_BACKOFF_MS) || 5000;   // first retry waits 2× this
const ALLOW_POWER = (env.DISCORD_SYNC_ALLOW_POWER || '').split(',').map((s) => s.trim()).filter(Boolean);
const ONCE = process.argv.includes('--once');
// Nicknames (0207): 'apply' writes them; 'plan' (or --nick-plan) only logs what
// it would write; anything else leaves every nickname alone.
const NICKS = process.argv.includes('--nick-plan') ? 'plan'
  : (['apply', 'plan'].includes(env.DISCORD_SYNC_NICKNAMES) ? env.DISCORD_SYNC_NICKNAMES : 'off');
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
for (const n of ['DISCORD_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[n]) { console.error(`✗ ${n} is not set — EnvironmentFile /etc/samo-discord-bot.env and /etc/samo-notify.env`); process.exit(1); }
}

// ── Discord ────────────────────────────────────────────────────────────────
const REASON = encodeURIComponent('ทีม SAMO sync — follows the website');
/** A network-level failure says only "fetch failed"; the reason (DNS, reset,
 *  timeout) is in `cause`. Name the host and keep the reason, or the alert
 *  cannot say which service was down (2026-09-23: "retrying in 10s: fetch
 *  failed", and nothing on the VM could say more). */
async function net(host, what, go) {
  try { return await go(); } catch (e) {
    const c = e?.cause; const why = c ? ` (${c.code || c.name || ''}${c.message ? `: ${c.message}` : ''})` : '';
    throw new Error(`${host} ${what}: ${e.message}${why}`);
  }
}

async function dc(path, init = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await net('Discord', `${init.method || 'GET'} ${path.split('?')[0]}`, () => fetch(API + path, { ...init, headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': REASON, ...(init.headers || {}) } }));
    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      const wait = Number(body.retry_after ?? r.headers.get('retry-after') ?? 1);
      log(`rate limited on ${init.method || 'GET'} ${path.split('/').slice(0, 3).join('/')}…, waiting ${wait}s${body.global ? ' (GLOBAL)' : ''}`);
      await sleep(Math.ceil(wait * 1000) + 100);
      continue;
    }
    if (!r.ok) throw new Error(`Discord HTTP ${r.status} ${init.method || 'GET'} ${path}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  }
  throw new Error(`gave up after repeated 429 on ${path}`);
}
const write = async (path, init) => { const out = await dc(path, init); await sleep(WRITE_GAP_MS); return out; };

// ── Postgres (service role; the paths it may use are pinned by a test) ─────
async function pg(path, init = {}) {
  const k = env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await net('Supabase', path.split('?')[0], () => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(init.headers || {}) } }));
  const body = await r.text();
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status} ${path.split('?')[0]}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

// ── The change log channel (DISCORD_SYNC_LOG_WEBHOOK, /etc/samo-notify.env) ─
// A NORMAL message (owner, 2026-09-23: the channel should be notified — it was
// sent silently, flag 4096, while the system was new) that still pings NOBODY
// (allowed_mentions none): <@id> renders a name without notifying that person.
// The webhook is a secret: env only, never the repo.
async function post(content) {
  const url = env.DISCORD_SYNC_LOG_WEBHOOK;
  if (!url) return;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
      if (r.status === 429) { const b = await r.json().catch(() => ({})); await sleep(Math.ceil((b.retry_after ?? 1) * 1000) + 100); continue; }
      if (!r.ok) log(`log webhook ${r.status}`);
      await sleep(1000);
      return;
    } catch (e) { log(`log webhook failed: ${e.message}`); return; }
  }
}

// One report per distinct problem, then quiet for 6 h — a full pass every 15
// min would otherwise repeat a standing problem 24 times a day.
const lastAlert = new Map();
const fresh = (key) => {
  const now = Date.now();
  if (lastAlert.has(key) && now - lastAlert.get(key) < 6 * 3600 * 1000) return false;
  lastAlert.set(key, now); return true;
};
async function alert(key, text) {
  if (!fresh(key)) return;
  log(`ALERT ${text}`);
  await post(`**⚠️ Discord sync** — ${text}`.slice(0, 1900));
}

let guildId = env.DISCORD_GUILD_ID || null;
let botId = null;
let ownerId = null;
// A nickname problem that cannot fix itself (no ชื่อเล่น in the web, the
// server owner) is reported ONCE per run of the service, not every 15 minutes.
const nickReported = new Set();

async function members() {
  const out = []; let after = '0';
  for (;;) { const p = await dc(`/guilds/${guildId}/members?limit=1000&after=${after}`); out.push(...p); if (p.length < 1000) break; after = p[p.length - 1].user.id; }
  return out;
}

async function pass(queue, forceFull = false) {
  queue = queue || [];
  const full = forceFull || queue.some((q) => q.kind !== 'person');
  const [roles, nodes, targets, orphanRows, nickInputs, academicYear] = await Promise.all([
    dc(`/guilds/${guildId}/roles`),
    pg('team_nodes?select=id,name,kind,parent_id,discord_role,discord_role_id'),
    pg('rpc/discord_role_targets', { method: 'POST', body: '{}' }),
    pg('discord_orphaned_accounts?select=discord_user_id,person_id'),
    // A failed read here must not stop the ROLE sync: null plans no rename.
    NICKS === 'off' ? [] : pg('rpc/discord_nickname_inputs', { method: 'POST', body: '{}' }).catch((e) => { log(`nickname inputs: ${e.message}`); return null; }),
    NICKS === 'off' ? null : pg('rpc/get_academic_year', { method: 'POST', body: '{}' }).catch((e) => { log(`academic year: ${e.message}`); return null; }),
  ]);
  // ⛔ An empty target set is "nobody linked" OR "this credential sees nothing";
  // to a diff those are the same input as "remove everything". Never act on it.
  if (!targets.length) { await alert('empty', 'discord_role_targets() returned NO rows — nothing applied.'); return false; }
  const bot = await dc(`/guilds/${guildId}/members/${botId}`);
  const botTop = Math.max(...bot.roles.map((r) => roles.find((x) => x.id === r)?.position ?? 0));

  // 1. renames — the web name is the truth
  const renamed = [];
  for (const q of queue.filter((x) => x.kind === 'rename')) {
    const n = nodes.find((x) => x.id === q.node_id);
    const role = n && roles.find((r) => r.id === n.discord_role_id);
    if (!role) continue;
    const want = expectedRoleName(n, nodes);
    if (role.name === want) continue;
    if (role.position >= botTop) { await alert(`rename:${role.id}`, `cannot rename "${role.name}" → "${want}": it sits above the bot`); continue; }
    await write(`/guilds/${guildId}/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ name: want }) });
    renamed.push({ role: role.id, from: role.name });
    role.name = want;
    log(`renamed role "${want}"`);
  }

  // 2. provisioning — only on a full pass (a tick is a 'structure' event)
  if (full) {
    const p = planProvision(nodes, roles);
    for (const a of p.adopt) {
      await pg(`team_nodes?id=eq.${a.node.id}`, { method: 'PATCH', body: JSON.stringify({ discord_role_id: a.role.id }) });
      a.node.discord_role_id = a.role.id; log(`adopted "${a.role.name}"`);
    }
    for (const c of p.create) {
      const role = await write(`/guilds/${guildId}/roles`, { method: 'POST', body: JSON.stringify({ name: c.name, permissions: '0', mentionable: false, hoist: false }) });
      if (!role?.id || role.name !== c.name) throw new Error(`Discord did not return the role "${c.name}"`);
      await pg(`team_nodes?id=eq.${c.node.id}`, { method: 'PATCH', body: JSON.stringify({ discord_role_id: role.id }) });
      roles.push(role); c.node.discord_role_id = role.id; log(`created role "${c.name}"`);
    }
    for (const h of p.held) await alert(`prov:${h.node.id}:${h.why}`, `ตำแหน่ง "${h.node.name}" ยังไม่มี role ใน Discord: ${h.why}`);
  }

  // 3. members — everyone on a full pass, else only the people the queue named
  let only = null;
  if (!full) {
    const persons = new Set(queue.map((q) => q.person_id).filter(Boolean));
    only = new Set(targets.filter((t) => persons.has(t.person_id)).map((t) => t.discord_user_id));
    for (const o of orphanRows) if (persons.has(o.person_id)) only.add(o.discord_user_id);
    for (const i of nickInputs || []) if (persons.has(i.person_id)) only.add(i.discord_user_id);
    if (!only.size && !renamed.length) return true;   // nobody linked among them: nothing on Discord to change
  }
  // Re-derive the managed set AFTER provisioning, from the nodes this pass saw.
  const managed = new Set(nodes.filter((n) => n.discord_role && n.discord_role_id).map((n) => n.discord_role_id));
  const everyone = await members();
  const diff = diffMembers({ roles, members: everyone, targets, managed,
    orphans: new Set(orphanRows.map((o) => o.discord_user_id)), onlyDiscordIds: only });
  for (const r of diff.missing) await alert(`missing:${r}`, `a ตำแหน่ง points at Discord role ${r}, which no longer exists — skipped`);
  const g = gate(diff, { roles, guildId, allowPower: ALLOW_POWER, botTop });
  const name = (id) => roles.find((r) => r.id === id)?.name || id;
  // One failed write is THAT person's problem, not the pass's: a throw here used
  // to abandon every later change until the retry. Reported with the others.
  const failed = [];
  const tryWrite = async (item, path, init, sign) => {
    try { await write(path, init); log(`${sign} ${item.who}  ${name(item.role)}`); return true; }
    catch (e) { log(`FAILED ${sign} ${item.who} ${name(item.role)}: ${e.message}`); failed.push({ ...item, why: `Discord ปฏิเสธ (${e.message.slice(0, 80)})` }); return false; }
  };
  const adds = []; const removes = [];
  for (const a of g.adds) if (await tryWrite(a, `/guilds/${guildId}/members/${a.member}/roles/${a.role}`, { method: 'PUT' }, '+')) adds.push(a);
  for (const r of g.removes) if (await tryWrite(r, `/guilds/${guildId}/members/${r.member}/roles/${r.role}`, { method: 'DELETE' }, '−')) removes.push(r);
  g.held.push(...failed);
  const newHeld = g.held.filter((h) => fresh(`held:${h.member}:${h.role}:${h.why}`));
  for (const h of g.held) log(`HELD ${h.who}: ${name(h.role)} — ${h.why}`);

  // 4. nicknames (0207) — the website's name, written after the keys.
  const nicks = []; const nickHeld = [];
  if (NICKS !== 'off' && nickInputs) {
    const plan = planNicknames({ members: everyone, inputs: nickInputs, roles, botTop, ownerId, academicYear, onlyDiscordIds: only });
    if (academicYear == null) log('nicknames: no ปีการศึกษา — no name planned this pass');
    // Posted only when a web EDIT named this person (a human is looking, and
    // can fix the data); a full pass only logs. The owner / above-the-bot cases
    // are structural and permanent — never posted: every deploy restarts this
    // service, and "the owner cannot be renamed" after each one is noise.
    const queuedPeople = new Set(queue.map((q) => q.person_id).filter(Boolean));
    const named = new Set(nickInputs.filter((i) => queuedPeople.has(i.person_id)).map((i) => i.discord_user_id));
    for (const k of plan.skipped) {
      log(`NICK SKIP ${k.member}: ${k.why}`);
      if (k.structural || !named.has(k.member)) continue;
      if (!nickReported.has(`${k.member}:${k.why}`)) { nickReported.add(`${k.member}:${k.why}`); nickHeld.push(k); }
    }
    for (const r of plan.renames) {
      if (NICKS === 'plan') { log(`NICK PLAN ${r.member}: "${r.from ?? r.shown}" → "${r.to}"`); continue; }
      try {
        await write(`/guilds/${guildId}/members/${r.member}`, { method: 'PATCH', body: JSON.stringify({ nick: r.to }) });
        nicks.push(r); log(`nick ${r.member}: "${r.from ?? r.shown}" → "${r.to}"`);
      } catch (e) {
        log(`FAILED nick ${r.member}: ${e.message}`);
        const why = /HTTP 403/.test(e.message) ? 'Discord ไม่อนุญาตให้บอทเปลี่ยนชื่อคนนี้' : `เปลี่ยนชื่อไม่สำเร็จ (${e.message.slice(0, 60)})`;
        if (!nickReported.has(`${r.member}:${why}`)) { nickReported.add(`${r.member}:${why}`); nickHeld.push({ member: r.member, why }); }
      }
    }
    if (NICKS === 'plan') log(`nick plan: ${plan.renames.length} to rename, ${plan.skipped.length} skipped`);
  }

  for (const m of formatReport({ queue, adds, removes, held: newHeld, renamed, nicks, nickHeld, full: !queue.length })) await post(m);
  if (full || adds.length || removes.length || nicks.length) log(`${full ? 'full' : 'event'} pass: +${adds.length} −${removes.length} held ${g.held.length} nicks ${nicks.length}`);
  return true;
}

async function main() {
  const me = await dc('/users/@me'); botId = me.id;
  if (!guildId) {
    const gs = await dc('/users/@me/guilds');
    if (gs.length !== 1) throw new Error(`bot is in ${gs.length} guilds — set DISCORD_GUILD_ID`);
    guildId = gs[0].id;
  }
  ownerId = (await dc(`/guilds/${guildId}`)).owner_id || null;
  log(`discord-sync up as ${me.username}; poll ${POLL_MS} ms, full pass every ${Math.round(FULL_MS / 60000)} min; power keys allowed: ${ALLOW_POWER.join(', ') || '(none)'}; nicknames: ${NICKS}`);
  if (ONCE) { await pass([], true); return; }

  // A blip is not news. The loop already retries; the channel hears about a
  // failure only once it has PERSISTED (FAILS_BEFORE_ALERT in a row, ~1 min),
  // and hears that it has recovered — a warning nobody withdraws reads as a
  // standing outage (2026-09-23: one "fetch failed" that healed in 100 s).
  const FAILS_BEFORE_ALERT = 3;
  let lastFull = 0; let backoff = 0; let fails = 0; let alerted = false;
  for (;;) {
    try {
      const queue = await pg('discord_sync_queue?select=id,kind,person_id,node_id,actor_name,detail&order=id&limit=1000');
      const due = Date.now() - lastFull >= FULL_MS;
      if (queue.length || due) {
        const ok = await pass(queue, due);
        if (due && ok) lastFull = Date.now();
        // Delete only what this pass SAW, and only after it succeeded — a row
        // queued mid-pass has a higher id and waits for the next one.
        // By id, not `id <= max`: ids are not committed in order, so a row
        // that took a LOWER id but committed after this read would be deleted
        // unprocessed by a range.
        if (queue.length && ok) await pg(`discord_sync_queue?id=in.(${queue.map((q) => Number(q.id)).join(',')})`, { method: 'DELETE' });
      }
      backoff = 0;
      if (alerted) { alerted = false; await post(`**✅ Discord sync** — กลับมาทำงานปกติแล้ว (ล้มเหลวติดกัน ${fails} ครั้งก่อนหน้านี้)`); }
      fails = 0;
    } catch (e) {
      fails += 1;
      backoff = Math.min((backoff || BACKOFF_MS) * 2, 5 * 60 * 1000);
      log(`error #${fails} — retrying in ${Math.round(backoff / 1000)}s: ${e.message}`);
      if (fails >= FAILS_BEFORE_ALERT && !alerted) {
        alerted = true;
        lastAlert.delete(`err`);
        await alert('err', `ล้มเหลวติดกัน ${fails} ครั้ง — ยังลองใหม่อยู่ทุก ${Math.round(backoff / 1000)} วินาที: ${e.message}`);
      }
      await sleep(backoff);
    }
    await sleep(POLL_MS);
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
