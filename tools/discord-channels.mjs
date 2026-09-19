#!/usr/bin/env node
// ============================================================
// discord-channels.mjs — give each ฝ่าย role the channels its OWN สมาชิก role
// already opens, so that "one role per new channel" (the ฝ่าย role) is true.
//
// WHY. Channel access in this server was granted to ตำแหน่ง roles (mostly
// `สมาชิกฝ่าย X`). Everyone in ฝ่าย X — head or member — receives the ฝ่าย X
// role from ทีม SAMO, so once the ฝ่าย role opens the same channels, a new
// channel needs ONE role and a head never misses a member channel (owner,
// 2026-09-19: "I have to click import หัวหน้าฝ่าย another, it's tiring").
//
// ⛔ NOBODY LOSES ANYTHING — BY CONSTRUCTION, AND THEN CHECKED.
//   · Only ALLOW bits are ever written. Discord computes a channel as
//     (@everyone overwrite) → (all role denies) → (all role allows) → member
//     overwrite, so adding allow bits to one role's overwrite can only ADD.
//     A copied DENY could take a permission from someone whose only source was
//     the server-wide role — so denies are never copied.
//   · Then the whole guild is recomputed, every human × every channel, before
//     and after; any bit lost by anyone REFUSES the run. The check is not the
//     guarantee; it is what catches the guarantee being wrong.
// ⛔ CATEGORY SYNC IS PRESERVED. A channel is "synced" when its overwrites equal
//   its category's. Because the plan copies wherever the สมาชิก role has an
//   overwrite, a synced channel and its category are copied TOGETHER and stay
//   equal. Checked: sync state before == after, or it refuses.
// ⛔ WHICH สมาชิก ROLE COUNTS: only one whose name IS the ฝ่าย's —
//   `สมาชิกฝ่าย X` for `ฝ่าย X`, compared with brackets and the ฝ่าย/สมาชิก
//   prefixes removed. A sub-team's member role under a bigger ฝ่าย (e.g.
//   `สมาชิกฝ่าย Art/Graphic` directly under ฝ่าย ComArt) is NOT the ฝ่าย's,
//   and copying it would open that sub-team's channel to the whole ฝ่าย.
//
// Plan here from a dump; apply on the VM (token), which re-fetches and refuses
// if the counts you read no longer hold:
//   node tools/discord-channels.mjs --dump full.json                 # plan
//   node tools/discord-channels.mjs --apply --writes N [--only 'ฝ่าย X']   # VM
// ============================================================
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VIEW = 1n << 10n;
const ADMIN = 1n << 3n;
const key = (s) => String(s ?? '').replace(/\([^)]*\)/g, '').replace(/^สมาชิก/, '')
  .replace(/^ฝ่าย/, '').replace(/\s+/g, '').toLowerCase();

/** Discord's channel permission algorithm (no threads/timeouts). */
export function effective(guild, member, roleIds, ch, rolesById) {
  let p = BigInt(rolesById.get(guild).permissions);
  for (const r of roleIds) p |= BigInt(rolesById.get(r)?.permissions || 0);
  if (p & ADMIN) return (1n << 53n) - 1n;
  const ow = ch.ow || [];
  const e = ow.find((o) => o.id === guild);
  if (e) { p &= ~BigInt(e.deny); p |= BigInt(e.allow); }
  let a = 0n; let d = 0n;
  for (const o of ow) if (o.type === 0 && roleIds.includes(o.id)) { a |= BigInt(o.allow); d |= BigInt(o.deny); }
  p &= ~d; p |= a;
  const m = ow.find((o) => o.type === 1 && o.id === member);
  if (m) { p &= ~BigInt(m.deny); p |= BigInt(m.allow); }
  return p;
}

const owKey = (ow) => JSON.stringify([...(ow || [])].map((o) => [o.id, o.type, String(o.allow), String(o.deny)]).sort());

/**
 * Pure. dump = {guild, roles, channels:[{id,name,type,parent_id,ow}], members}
 * nodes = [{id,name,kind,parent_id,discord_role,discord_role_id}]
 */
export function planChannels(dump, nodes, only = []) {
  const byParent = new Map();
  for (const n of nodes) if (n.parent_id) (byParent.get(n.parent_id) || byParent.set(n.parent_id, []).get(n.parent_id)).push(n);
  const writes = []; const noSource = [];
  for (const d of nodes) {
    if (d.kind !== 'division' || !d.discord_role || !d.discord_role_id) continue;
    if (only.length && !only.includes(d.name)) continue;
    const own = (byParent.get(d.id) || []).filter((k) => /^สมาชิก/.test(k.name) && k.discord_role_id && key(k.name) === key(d.name));
    if (!own.length) { noSource.push(d.name); continue; }
    for (const c of dump.channels) {
      let add = 0n;
      for (const src of own) {
        const o = (c.ow || []).find((x) => x.type === 0 && x.id === src.discord_role_id);
        if (o) add |= BigInt(o.allow);
      }
      if (!add) continue;
      const cur = (c.ow || []).find((x) => x.type === 0 && x.id === d.discord_role_id);
      const allow = (cur ? BigInt(cur.allow) : 0n) | add;
      const deny = (cur ? BigInt(cur.deny) : 0n) & ~allow;
      if (cur && BigInt(cur.allow) === allow && BigInt(cur.deny) === deny) continue;
      writes.push({ channel: c.id, channelName: c.name, type: c.type, role: d.discord_role_id, roleName: d.name,
        allow: String(allow), deny: String(deny), from: own.map((o) => o.name) });
    }
  }
  return { writes, noSource };
}

/** Apply writes to a copy of the dump, for the before/after proof. */
export function simulate(dump, writes) {
  const channels = dump.channels.map((c) => ({ ...c, ow: (c.ow || []).map((o) => ({ ...o })) }));
  const byId = new Map(channels.map((c) => [c.id, c]));
  for (const w of writes) {
    const c = byId.get(w.channel);
    const cur = c.ow.find((o) => o.type === 0 && o.id === w.role);
    if (cur) { cur.allow = w.allow; cur.deny = w.deny; } else c.ow.push({ id: w.role, type: 0, allow: w.allow, deny: w.deny });
  }
  return { ...dump, channels };
}

/** Every human × every channel: bits lost (must be none) and gains. Plus sync state. */
export function verify(before, after) {
  const rolesById = new Map(before.roles.map((r) => [r.id, r]));
  const lost = []; const gained = new Map();
  const aById = new Map(after.channels.map((c) => [c.id, c]));
  for (const m of before.members.filter((x) => !x.bot)) {
    for (const c of before.channels) {
      const p0 = effective(before.guild, m.id, m.roles, c, rolesById);
      const p1 = effective(before.guild, m.id, m.roles, aById.get(c.id), rolesById);
      if (p0 & ~p1) lost.push(`${m.display} #${c.name}`);
      if ((p1 & VIEW) && !(p0 & VIEW)) (gained.get(c.name) || gained.set(c.name, []).get(c.name)).push(m.display);
    }
  }
  const synced = (dump) => {
    const byId = new Map(dump.channels.map((c) => [c.id, c]));
    return dump.channels.filter((c) => c.parent_id && owKey(c.ow) === owKey(byId.get(c.parent_id)?.ow)).map((c) => c.id).sort();
  };
  const s0 = synced(before); const s1 = synced(after);
  return { lost, gained, syncBefore: s0.length, syncAfter: s1.length,
    unsynced: s0.filter((id) => !s1.includes(id)), newlySynced: s1.filter((id) => !s0.includes(id)) };
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const only = (val('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const apply = args.includes('--apply');
  const env = process.env;

  let dump; let nodes;
  if (apply) {
    // On the VM: fresh guild + nodes over PostgREST (service key), never a file.
    const API = (() => {
      const o = env.DISCORD_API_BASE;
      return o && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(o) ? o : 'https://discord.com/api/v10';
    })();
    const h = { Authorization: `Bot ${env.DISCORD_TOKEN}` };
    const get = async (p) => { const r = await fetch(API + p, { headers: h }); if (!r.ok) throw new Error(`HTTP ${r.status} GET ${p}`); return r.json(); };
    const guilds = await get('/users/@me/guilds');
    const guild = env.DISCORD_GUILD_ID || (guilds.length === 1 ? guilds[0].id : null);
    if (!guild) throw new Error('set DISCORD_GUILD_ID');
    const roles = await get(`/guilds/${guild}/roles`);
    const chans = await get(`/guilds/${guild}/channels`);
    const members = []; let after = '0';
    for (;;) { const p = await get(`/guilds/${guild}/members?limit=1000&after=${after}`); members.push(...p); if (p.length < 1000) break; after = p[p.length - 1].user.id; }
    dump = { guild, roles: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions })),
      channels: chans.map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, ow: c.permission_overwrites })),
      members: members.map((m) => ({ id: m.user.id, display: m.nick || m.user.global_name || m.user.username, roles: m.roles, bot: !!m.user.bot })) };
    const key2 = env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/team_nodes?select=id,name,kind,parent_id,discord_role,discord_role_id`, { headers: { apikey: key2, Authorization: `Bearer ${key2}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status} team_nodes`);
    nodes = await r.json();
  } else {
    const f = val('--dump');
    if (!f) { console.error('✗ --dump <full.json> (plan) or --apply (on the VM)'); process.exit(1); }
    dump = JSON.parse(readFileSync(f, 'utf8'));
    const { loadEnv, resolveTarget, runSql } = await import('./env-lib.mjs');
    nodes = JSON.parse(await runSql('select id, name, kind, parent_id, discord_role, discord_role_id from public.team_nodes;', resolveTarget(loadEnv())));
  }

  const { writes, noSource } = planChannels(dump, nodes, only);
  const v = verify(dump, simulate(dump, writes));
  const byRole = new Map();
  for (const w of writes) (byRole.get(w.roleName) || byRole.set(w.roleName, []).get(w.roleName)).push(w);
  console.log(`PLAN: ${writes.length} channel grant(s) across ${byRole.size} ฝ่าย role(s). Allow bits only — no deny is ever written.`);
  for (const [r, ws] of byRole) console.log(`  ${r}  ← as ${ws[0].from.join(' / ')}:  ${ws.map((w) => (w.type === 4 ? '[หมวด] ' : '#') + w.channelName).join(', ')}`);
  console.log(`\nNO สมาชิก ROLE TO COPY FROM: ${noSource.length} ฝ่าย (left as they are).`);
  console.log(`\nPROOF over ${dump.members.filter((m) => !m.bot).length} humans × ${dump.channels.length} channels:`);
  console.log(`  permissions LOST by anyone: ${v.lost.length}`);
  v.lost.slice(0, 20).forEach((l) => console.log(`    ✗ ${l}`));
  const gainN = [...v.gained.values()].reduce((a, b) => a + b.length, 0);
  console.log(`  channels newly VISIBLE: ${gainN} (person × channel), in ${v.gained.size} channel(s)`);
  for (const [c, who] of v.gained) console.log(`    #${c}: ${who.join(', ')}`);
  console.log(`  category sync: ${v.syncBefore} synced before, ${v.syncAfter} after; broken ${v.unsynced.length}, newly synced ${v.newlySynced.length}`);

  const refuse = v.lost.length || v.unsynced.length;
  if (!apply) {
    console.log(refuse ? '\n⛔ WOULD REFUSE — see above.' : `\nPLAN ONLY — nothing was written.\n  on the VM: node discord-channels.mjs --apply --writes ${writes.length}${only.length ? ` --only '${only.join(',')}'` : ''}`);
    return;
  }
  if (Number(val('--writes')) !== writes.length) { console.error(`\n✗ REFUSED — plan changed: you passed --writes ${val('--writes')}, now ${writes.length}.`); process.exit(1); }
  if (refuse) { console.error('\n✗ REFUSED — someone would lose a permission, or a channel would fall out of sync.'); process.exit(1); }
  if (writes.some((w) => BigInt(w.deny) & ~(BigInt(dump.channels.find((c) => c.id === w.channel).ow.find((o) => o.id === w.role)?.deny || 0)))) {
    console.error('\n✗ REFUSED — a write would ADD a deny bit.'); process.exit(1);
  }

  const API = (() => { const o = env.DISCORD_API_BASE; return o && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(o) ? o : 'https://discord.com/api/v10'; })();
  let n = 0;
  for (const w of writes) {
    for (;;) {
      const r = await fetch(`${API}/channels/${w.channel}/permissions/${w.role}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json',
          // latin-1 only in a header — encode (docs/mistakes/integrations.md)
          'X-Audit-Log-Reason': encodeURIComponent('ทีม SAMO: ฝ่าย role gets its สมาชิก channels') },
        body: JSON.stringify({ type: 0, allow: w.allow, deny: w.deny }),
      });
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, Number(r.headers.get('retry-after') || 1) * 1000)); continue; }
      if (r.status !== 204) throw new Error(`HTTP ${r.status} on #${w.channelName} for ${w.roleName} after ${n} write(s): ${(await r.text()).slice(0, 200)}`);
      break;
    }
    n++;
    console.log(`  + ${w.roleName}  →  ${w.type === 4 ? '[หมวด] ' : '#'}${w.channelName}`);
    await new Promise((ok) => setTimeout(ok, 300));
  }
  console.log(`\n✓ ${n} of ${writes.length} channel grant(s) written. Re-run the plan: it should now be 0.`);
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
