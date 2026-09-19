#!/usr/bin/env node
// ============================================================
// discord-keep-access.mjs — make a person's Discord KEYS match ทีม SAMO while
// keeping their channel ACCESS exactly as it was (owner, 2026-09-19: "the web
// is the absolute truth" + "if they previously got permission to access
// something, it should still persist").
//
// WHY A PERSONAL OVERWRITE AND NOT "GIVE THE WEB ROLE THE CHANNEL". A mirrored
// role follows the ตำแหน่ง, not the person. Keeping โลมา's `#รวม-head` by
// granting it to `ฝ่ายประชาสัมพันธ์ SMST Syringe` would hand the heads' room to
// every future SMST PR member. A member overwrite on the channel is exactly
// this person, now — no one else, and no one later.
//
// WHAT IT DOES, per linked person with a ตำแหน่ง:
//   extra = mirrored roles they hold that ทีม SAMO does not give them
//   loss  = per channel, the permission bits removing `extra` would take
//   1. a MEMBER overwrite allowing exactly `loss` (merged into any existing one)
//   2. then remove `extra`
// ⛔ REFUSES unless, simulated, EVERY human's permissions in EVERY channel are
//   bit-for-bit what they were — the person included — and category sync is
//   unchanged. After applying it re-fetches and checks the same thing for real.
// ⛔ Only mirrored roles (a ticked node owns them) are ever removed. A role with
//   server-wide permissions is refused: a channel overwrite cannot replace it.
//
//   node tools/discord-keep-access.mjs --dump full.json            # plan here
//   node discord-keep-access.mjs --apply --passes N --remove M      # on the VM
// ============================================================
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { effective } from './discord-channels.mjs';

const owKey = (ow) => JSON.stringify([...(ow || [])].map((o) => [o.id, o.type, String(o.allow), String(o.deny)]).sort());

/** Pure. targets = discord_role_targets() rows; mapped = Set of mirrored role ids. */
export function planKeepAccess(dump, targets, mapped, only = null) {
  const R = new Map(dump.roles.map((r) => [r.id, r]));
  const byUser = new Map(targets.map((t) => [t.discord_user_id, t]));
  const passes = []; const removals = []; const refused = [];
  for (const m of dump.members.filter((x) => !x.bot)) {
    if (only && m.id !== only) continue;
    const t = byUser.get(m.id);
    if (!t || !t.placements) continue;             // unlinked or a leaver: not ours to judge
    const extra = m.roles.filter((r) => mapped.has(r) && !(t.role_ids || []).includes(r));
    if (!extra.length) continue;
    const server = extra.filter((r) => R.get(r)?.permissions && R.get(r).permissions !== '0');
    if (server.length) { refused.push(`${m.display}: ${server.map((r) => R.get(r).name).join(', ')} has server-wide permissions`); continue; }
    const after = m.roles.filter((r) => !extra.includes(r));
    for (const c of dump.channels) {
      const loss = effective(dump.guild, m.id, m.roles, c, R) & ~effective(dump.guild, m.id, after, c, R);
      if (!loss) continue;
      const cur = (c.ow || []).find((o) => o.type === 1 && o.id === m.id);
      const allow = (cur ? BigInt(cur.allow) : 0n) | loss;
      const deny = (cur ? BigInt(cur.deny) : 0n) & ~allow;
      passes.push({ channel: c.id, channelName: c.name, type: c.type, member: m.id, who: m.display, allow: String(allow), deny: String(deny) });
    }
    for (const r of extra) removals.push({ member: m.id, who: m.display, role: r, roleName: R.get(r)?.name });
  }
  return { passes, removals, refused };
}

export function simulate(dump, passes, removals) {
  const channels = dump.channels.map((c) => ({ ...c, ow: (c.ow || []).map((o) => ({ ...o })) }));
  const byId = new Map(channels.map((c) => [c.id, c]));
  for (const p of passes) {
    const c = byId.get(p.channel);
    const cur = c.ow.find((o) => o.type === 1 && o.id === p.member);
    if (cur) { cur.allow = p.allow; cur.deny = p.deny; } else c.ow.push({ id: p.member, type: 1, allow: p.allow, deny: p.deny });
  }
  const members = dump.members.map((m) => ({ ...m, roles: m.roles.filter((r) => !removals.some((x) => x.member === m.id && x.role === r)) }));
  return { ...dump, channels, members };
}

/** Exact equality, every human × every channel, plus category sync. */
export function sameAccess(before, after) {
  const R = new Map(before.roles.map((r) => [r.id, r]));
  const aM = new Map(after.members.map((m) => [m.id, m]));
  const aC = new Map(after.channels.map((c) => [c.id, c]));
  const diff = [];
  for (const m of before.members.filter((x) => !x.bot)) {
    const m2 = aM.get(m.id);
    if (!m2) continue;
    for (const c of before.channels) {
      const c2 = aC.get(c.id);
      if (!c2) continue;
      const p0 = effective(before.guild, m.id, m.roles, c, R);
      const p1 = effective(before.guild, m.id, m2.roles, c2, R);
      if (p0 !== p1) diff.push(`${m.display} #${c.name}: ${p0 & ~p1 ? 'LOST' : ''}${p1 & ~p0 ? 'GAINED' : ''}`);
    }
  }
  const synced = (d) => { const b = new Map(d.channels.map((c) => [c.id, c])); return d.channels.filter((c) => c.parent_id && owKey(c.ow) === owKey(b.get(c.parent_id)?.ow)).map((c) => c.id).sort().join(); };
  return { diff, syncSame: synced(before) === synced(after) };
}

async function main() {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const env = process.env;
  const apply = args.includes('--apply');
  const only = val('--only');
  const API = (() => { const o = env.DISCORD_API_BASE; return o && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(o) ? o : 'https://discord.com/api/v10'; })();
  const h = { Authorization: `Bot ${env.DISCORD_TOKEN}` };
  const get = async (p) => { const r = await fetch(API + p, { headers: h }); if (!r.ok) throw new Error(`HTTP ${r.status} GET ${p}`); return r.json(); };
  const fetchDump = async (guild) => {
    const roles = await get(`/guilds/${guild}/roles`); const chans = await get(`/guilds/${guild}/channels`);
    const members = []; let after = '0';
    for (;;) { const p = await get(`/guilds/${guild}/members?limit=1000&after=${after}`); members.push(...p); if (p.length < 1000) break; after = p[p.length - 1].user.id; }
    return { guild, roles: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions })),
      channels: chans.map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, ow: c.permission_overwrites })),
      members: members.map((m) => ({ id: m.user.id, display: m.nick || m.user.global_name || m.user.username, roles: m.roles, bot: !!m.user.bot })) };
  };

  let dump; let targets; let mapped;
  if (apply) {
    const guilds = await get('/users/@me/guilds');
    const guild = env.DISCORD_GUILD_ID || (guilds.length === 1 ? guilds[0].id : null);
    dump = await fetchDump(guild);
    const k = env.SUPABASE_SERVICE_ROLE_KEY;
    const pg = async (p, init = {}) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { ...init, headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`); return r.json(); };
    targets = await pg('rpc/discord_role_targets', { method: 'POST', body: '{}' });
    mapped = new Set((await pg('team_nodes?select=discord_role_id&discord_role_id=not.is.null')).map((n) => n.discord_role_id));
  } else {
    dump = JSON.parse(readFileSync(val('--dump'), 'utf8'));
    const { loadEnv, resolveTarget, runSql } = await import('./env-lib.mjs');
    const t = resolveTarget(loadEnv());
    targets = JSON.parse(await runSql('select * from public.discord_role_targets();', t));
    mapped = new Set(JSON.parse(await runSql('select discord_role_id from public.team_nodes where discord_role_id is not null;', t)).map((r) => r.discord_role_id));
  }
  if (!targets.length) { console.error('✗ REFUSED — empty target set (never read as "remove everything")'); process.exit(1); }

  const { passes, removals, refused } = planKeepAccess(dump, targets, mapped, only);
  const byWho = new Map();
  for (const r of removals) (byWho.get(r.who) || byWho.set(r.who, { rm: [], ps: [] }).get(r.who)).rm.push(r.roleName);
  for (const p of passes) (byWho.get(p.who) || byWho.set(p.who, { rm: [], ps: [] }).get(p.who)).ps.push((p.type === 4 ? '[หมวด] ' : '#') + p.channelName);
  console.log(`PLAN: ${removals.length} extra key(s) removed from ${byWho.size} people; ${passes.length} personal pass(es) so nobody loses a room.`);
  for (const [w, x] of byWho) console.log(`  ${w}\n      − ${x.rm.join(', ')}${x.ps.length ? `\n      personal pass: ${x.ps.join(', ')}` : '\n      (no pass needed — nothing is lost)'}`);
  if (refused.length) { console.log('\nREFUSED FOR:'); refused.forEach((r) => console.log(`  ${r}`)); }
  const v = sameAccess(dump, simulate(dump, passes, removals));
  console.log(`\nPROOF (simulated): access changed for ${v.diff.length} person×channel; category sync ${v.syncSame ? 'unchanged' : 'CHANGED'}.`);
  v.diff.slice(0, 20).forEach((d) => console.log(`    ✗ ${d}`));
  const bad = v.diff.length || !v.syncSame;
  if (!apply) { console.log(bad ? '\n⛔ WOULD REFUSE.' : `\nPLAN ONLY.  on the VM: --apply --passes ${passes.length} --remove ${removals.length}${only ? ` --only ${only}` : ''}`); return; }
  if (Number(val('--passes')) !== passes.length || Number(val('--remove')) !== removals.length) { console.error(`\n✗ REFUSED — plan changed (now --passes ${passes.length} --remove ${removals.length}).`); process.exit(1); }
  if (bad) { console.error('\n✗ REFUSED — access would change.'); process.exit(1); }

  const reason = { 'X-Audit-Log-Reason': encodeURIComponent('ทีม SAMO: keys match the web, access kept') };
  const send = async (path, init) => {
    for (;;) {
      const r = await fetch(API + path, { ...init, headers: { ...h, 'Content-Type': 'application/json', ...reason } });
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, Number(r.headers.get('retry-after') || 1) * 1000)); continue; }
      if (r.status !== 204) throw new Error(`HTTP ${r.status} ${init.method} ${path}: ${(await r.text()).slice(0, 200)}`);
      return;
    }
  };
  // Passes FIRST: if the run dies between the two halves, people hold an extra
  // pass (harmless, same access) rather than having lost a room.
  for (const p of passes) { await send(`/channels/${p.channel}/permissions/${p.member}`, { method: 'PUT', body: JSON.stringify({ type: 1, allow: p.allow, deny: p.deny }) }); await new Promise((ok) => setTimeout(ok, 300)); }
  console.log(`  ✓ ${passes.length} personal pass(es) written`);
  for (const r of removals) { await send(`/guilds/${dump.guild}/members/${r.member}/roles/${r.role}`, { method: 'DELETE' }); console.log(`  − ${r.who}  ${r.roleName}`); await new Promise((ok) => setTimeout(ok, 400)); }
  console.log(`  ✓ ${removals.length} key(s) removed`);

  const real = sameAccess(dump, await fetchDump(dump.guild));
  console.log(`\nPROOF (re-read from Discord): access changed for ${real.diff.length} person×channel; category sync ${real.syncSame ? 'unchanged' : 'CHANGED'}.`);
  real.diff.slice(0, 30).forEach((d) => console.log(`    ✗ ${d}`));
  if (real.diff.length || !real.syncSame) process.exit(2);
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
