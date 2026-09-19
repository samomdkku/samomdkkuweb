// ============================================================
// discord-sync-core.mjs — the pure half of the always-on Discord sync.
// No I/O here: server/discord-sync.mjs fetches, this decides, it writes.
//
// WHAT "IN SYNC" MEANS (owner, 2026-09-19): "everything should be according to
// the website". discord_role_targets() (0184, 0196) is the ONE rule for which
// keys a linked person is due; this file only diffs it against the guild.
//
//   linked, with a ตำแหน่ง   → holds exactly their due MIRRORED keys
//   linked, no ตำแหน่ง        → holds no mirrored key            (left SAMO)
//   was linked, is not now   → holds no mirrored key            (0187)
//   never linked             → UNTOUCHED — absence is unknown, not "nothing"
// A key no ticked node owns (Moderator, 🏅 อุปนายกฯ, bots) is never touched, by
// construction: only ids in `managed` can be removed. Personal channel passes
// are channel overwrites, not keys — nothing here reads or changes them.
// ============================================================

export const POWER_BITS = {
  1: 'KICK_MEMBERS', 2: 'BAN_MEMBERS', 3: 'ADMINISTRATOR', 4: 'MANAGE_CHANNELS',
  5: 'MANAGE_GUILD', 13: 'MANAGE_MESSAGES', 17: 'MENTION_EVERYONE', 22: 'MUTE_MEMBERS',
  23: 'DEAFEN_MEMBERS', 24: 'MOVE_MEMBERS', 27: 'MANAGE_NICKNAMES', 28: 'MANAGE_ROLES',
  29: 'MANAGE_WEBHOOKS', 30: 'MANAGE_EMOJIS', 33: 'MANAGE_EVENTS', 34: 'MANAGE_THREADS', 40: 'MODERATE_MEMBERS',
};

export function serverPowers(role, everyone) {
  const extra = BigInt(role?.permissions || 0) & ~BigInt(everyone?.permissions || 0);
  return Object.entries(POWER_BITS).filter(([b]) => extra & (1n << BigInt(b))).map(([, n]) => n);
}

const display = (m) => m.nick || m.user?.global_name || m.user?.username || m.user?.id;

/**
 * The member diff. `onlyDiscordIds` (a Set) narrows it to the people a queued
 * event named; null means everyone (the full pass).
 */
export function diffMembers({ roles, members, targets, managed, orphans, onlyDiscordIds = null }) {
  const exists = new Set(roles.map((r) => r.id));
  const byUser = new Map(targets.map((t) => [t.discord_user_id, t]));
  const adds = []; const removes = []; const missing = new Set();
  for (const m of members) {
    if (m.user?.bot) continue;
    const id = m.user.id;
    if (onlyDiscordIds && !onlyDiscordIds.has(id)) continue;
    const t = byUser.get(id);
    let due;
    if (t && t.placements > 0) due = new Set((t.role_ids || []).filter((r) => { if (!exists.has(r)) { missing.add(r); return false; } return true; }));
    else if (t) due = new Set();                        // linked, left SAMO
    else if (orphans.has(id)) due = new Set();          // was linked, is not
    else continue;                                       // never linked: unknown
    for (const r of due) if (!m.roles.includes(r)) adds.push({ member: id, who: display(m), role: r });
    for (const r of m.roles) if (managed.has(r) && !due.has(r)) removes.push({ member: id, who: display(m), role: r });
  }
  return { adds, removes, missing: [...missing] };
}

/**
 * The automatic brakes. Adds are applied; a batch of REMOVALS big enough to be
 * a mistake (an accidental delete of a whole ฝ่าย) is held for a human — the
 * add-side of the same batch still goes through. Power keys need the owner's
 * name on them (--allow-power / DISCORD_SYNC_ALLOW_POWER), always.
 */
export function gate({ adds, removes }, { roles, guildId, allowPower = [], botTop = Infinity,
  maxRemovals = 10, maxRemovalPeople = 5 }) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const everyone = byId.get(guildId);
  const held = []; const ok = { adds: [], removes: [] };
  for (const a of adds) {
    const role = byId.get(a.role);
    const pw = serverPowers(role, everyone);
    if (pw.length && !allowPower.includes(role.name)) { held.push({ ...a, why: `power key (${pw.join(', ')}) not approved` }); continue; }
    if (role.position >= botTop) { held.push({ ...a, why: 'role sits at or above the bot' }); continue; }
    ok.adds.push(a);
  }
  const people = new Set(removes.map((r) => r.member));
  if (removes.length > maxRemovals || people.size > maxRemovalPeople) {
    for (const r of removes) held.push({ ...r, why: `bulk removal held (${removes.length} keys / ${people.size} people)` });
  } else {
    for (const r of removes) {
      if (byId.get(r.role)?.position >= botTop) { held.push({ ...r, why: 'role sits at or above the bot' }); continue; }
      ok.removes.push(r);
    }
  }
  return { ...ok, held };
}

const short = (x) => String(x).replace(/\([^)]*\)/g, '').replace(/^ฝ่าย\s*/, '').trim();

/**
 * The Discord name a mapped node's role should carry: the web name, qualified
 * by its parent only when another TICKED node shares it (§5b).
 */
export function expectedRoleName(node, nodes) {
  const twins = nodes.filter((n) => n.discord_role && n.name === node.name && n.id !== node.id);
  if (!twins.length) return node.name;
  const parent = nodes.find((n) => n.id === node.parent_id);
  return parent ? `${node.name} · ${short(parent.name)}` : node.name;
}

// Same normaliser as discord-provision.mjs (trim BEFORE the ฝ่าย prefix — the
// 📇 duplicate, docs/mistakes/integrations.md).
export const norm = (x) => String(x)
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200B}-\u{200D}]/gu, '')
  .trim().replace(/\([^)]*\)/g, '').replace(/^ฝ่าย\s*/, '').replace(/\s+/g, '').toLowerCase().trim();

/**
 * A ticked node with no role: adopt the ONE unmapped role of exactly that name,
 * create one when nothing resembles it, and HOLD for a human when something
 * only resembles it (a near match is how the 📇 duplicate happened).
 */
export function planProvision(nodes, roles, { cap = 245 } = {}) {
  const mapped = new Set(nodes.map((n) => n.discord_role_id).filter(Boolean));
  const free = roles.filter((r) => !r.managed && r.name !== '@everyone' && !mapped.has(r.id));
  const adopt = []; const create = []; const held = [];
  const names = new Set(roles.map((r) => r.name));
  for (const n of nodes.filter((x) => x.discord_role && !x.discord_role_id)) {
    const want = expectedRoleName(n, nodes);
    const exact = free.filter((r) => r.name === want);
    if (exact.length === 1) { adopt.push({ node: n, role: exact[0] }); continue; }
    if (exact.length > 1) { held.push({ node: n, why: `${exact.length} roles are named "${want}"` }); continue; }
    const near = roles.filter((r) => norm(r.name) === norm(want));
    if (near.length) { held.push({ node: n, why: `resembles existing "${near[0].name}" — a human decides` }); continue; }
    if (names.has(want)) { held.push({ node: n, why: `"${want}" is taken` }); continue; }
    names.add(want);
    create.push({ node: n, name: want });
  }
  const room = Math.max(0, cap - roles.length);
  if (create.length > room) {
    for (const c of create.splice(room)) held.push({ node: c.node, why: `role cap (${cap}) reached` });
  }
  return { adopt, create, held };
}
