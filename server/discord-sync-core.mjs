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

import { studyYear, setAcademicYear } from '../src/js/study-year.js';
import { arabicDigits } from '../src/js/utils.js';

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

// ── Nicknames (0207, DISCORD-ROLE-SYNC §8e.2) ───────────────────────────────
// The server's pattern, which the old bot set and people read:
//   ชื่อเล่น_#ชั้นปี_XXX-X      e.g. บอส_#5_033-4
// XXX-X is the last four digits of รหัสนักศึกษา. ชั้นปี comes from
// src/js/study-year.js — the ONE implementation the website shows — with the
// admin-set ปีการศึกษา (get_academic_year) primed into it.
export const NICK_MAX = 32;   // Discord's limit, in UTF-16 units (JS .length)

/** The nickname ทีม SAMO says this person should carry, or { skip: why }. */
export function wantedNickname(p, academicYear) {
  const nick = String(p?.nickname ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!nick) return { skip: 'ไม่มีชื่อเล่นในเว็บ' };
  const d = arabicDigits(p?.student_id).replace(/\D/g, '');
  if (d.length < 4) return { skip: 'ไม่มีรหัสนักศึกษาในเว็บ' };
  setAcademicYear(academicYear);
  const y = studyYear(p);
  if (!Number.isInteger(y) || y < 1 || y > 6) return { skip: `ชั้นปีคำนวณได้ ${y ?? '—'} (นอกช่วงปี 1–6)` };
  const name = `${nick}_#${y}_${d.slice(-4, -1)}-${d.slice(-1)}`;
  if (name.length > NICK_MAX) return { skip: `ยาวเกิน ${NICK_MAX} ตัวอักษร (${name})` };
  return { name };
}

/**
 * Which members to rename. Only LINKED members (the inputs are keyed by the
 * Discord id the person proved by OAuth or the approved import), never someone
 * who never linked. A bot cannot rename the server owner or anyone whose top
 * role is at/above its own — those are SKIPPED with a reason, never attempted
 * (Discord answers 403 and, unhandled, that aborted the whole pass).
 * `academicYear` must be the admin-set value: on a failed read the caller
 * passes null and NOTHING is planned — a clock guess near the rollover would
 * be reverted by the next pass, renaming people back and forth.
 */
export function planNicknames({ members, inputs, roles, botTop, ownerId, academicYear, onlyDiscordIds = null }) {
  const out = { renames: [], skipped: [] };
  if (!Number.isFinite(Number(academicYear)) || Number(academicYear) < 2400) return out;
  const pos = new Map(roles.map((r) => [r.id, r.position]));
  const byUser = new Map(inputs.map((i) => [i.discord_user_id, i]));
  for (const m of members) {
    if (m.user?.bot) continue;
    const id = m.user.id;
    if (onlyDiscordIds && !onlyDiscordIds.has(id)) continue;
    const p = byUser.get(id);
    if (!p) continue;                                   // never linked: not ours to name
    const w = wantedNickname(p, academicYear);
    if (w.skip) { out.skipped.push({ member: id, shown: display(m), why: w.skip }); continue; }
    // Already READS right: the server nickname, or — with none set — the name
    // Discord shows instead. The first plan wanted to set 25 members' nick to
    // the exact text they already displayed; a write that changes nothing on
    // screen is only noise in the channel. If they change that global name
    // later, the next pass sets the nickname.
    if ((m.nick ?? display(m)) === w.name) continue;
    if (id === ownerId) { out.skipped.push({ member: id, shown: display(m), want: w.name, why: 'เจ้าของเซิร์ฟเวอร์ — บอทเปลี่ยนชื่อให้ไม่ได้', structural: true }); continue; }
    const top = Math.max(0, ...m.roles.map((r) => pos.get(r) ?? 0));
    if (top >= botTop) { out.skipped.push({ member: id, shown: display(m), want: w.name, why: 'role สูงกว่าบอท — บอทเปลี่ยนชื่อให้ไม่ได้', structural: true }); continue; }
    out.renames.push({ member: id, from: m.nick ?? null, shown: display(m), to: w.name });
  }
  return out;
}

/** A person as TEXT for the channel. A <@id> mention is resolved by each
 *  reader's Discord app from the members it has loaded — and the sender turns
 *  mention parsing off (so nobody is pinged), which leaves the message with no
 *  user data: members the app has not loaded show as @unknown-user and cannot
 *  be opened (owner, 2026-09-23). A name in the text always reads. */
/** Markdown-escaped, never stripped: the server's own pattern is full of `_`
 *  (บอส_#5_033-4), and stripping it rewrote every name it printed. */
export const mdEscape = (x) => String(x ?? '').replace(/([\\*_`~|>#:<-])/g, '\\$1');
export const nameText = (x) => `**${mdEscape(String(x ?? '').trim()) || 'ไม่ทราบชื่อ'}**`;

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

/**
 * The change log posted to the role-bot channel (owner, 2026-09-19): WHO edited
 * ทีม SAMO, WHAT they changed, and WHOSE Discord keys moved. Mentions use
 * Discord's <@id> / <@&id> so names render — the sender turns every ping OFF
 * (allowed_mentions: none) and sends silently (flag 4096).
 * Returns message bodies, each under Discord's 2000-character limit.
 */
export function formatReport({ queue = [], adds = [], removes = [], held = [], renamed = [], nicks = [], nickHeld = [], full = false }) {
  if (!adds.length && !removes.length && !held.length && !renamed.length && !nicks.length && !nickHeld.length) return [];
  const lines = [];
  const actors = [...new Set(queue.map((q) => q.actor_name).filter(Boolean))];
  const details = [...new Set(queue.map((q) => q.detail).filter(Boolean))];
  if (actors.length) lines.push(`**แก้โดย:** ${actors.join(', ')}`);
  else if (full) lines.push('**ตรวจรอบอัตโนมัติ** — ปรับ Discord ให้ตรงกับหน้าเว็บทีม SAMO (อาจมีคนแก้ role ใน Discord เอง)');
  if (details.length) { lines.push('**สิ่งที่แก้ในเว็บ:**'); for (const d of details.slice(0, 20)) lines.push(`• ${d}`); if (details.length > 20) lines.push(`• …และอีก ${details.length - 20} รายการ`); }
  if (renamed.length) { lines.push('**เปลี่ยนชื่อ role:**'); for (const r of renamed) lines.push(`• <@&${r.role}> ← เดิม "${r.from}"`); }
  const by = new Map();
  for (const a of adds) (by.get(a.member) || by.set(a.member, { who: a.who, add: [], rm: [] }).get(a.member)).add.push(a.role);
  for (const r of removes) (by.get(r.member) || by.set(r.member, { who: r.who, add: [], rm: [] }).get(r.member)).rm.push(r.role);
  if (by.size) {
    lines.push('**ผลใน Discord:**');
    for (const [m, x] of by) {
      const parts = [];
      if (x.add.length) parts.push(`ได้ ${x.add.map((r) => `<@&${r}>`).join(' ')}`);
      if (x.rm.length) parts.push(`ถูกเอาออก ${x.rm.map((r) => `<@&${r}>`).join(' ')}`);
      lines.push(`• ${nameText(x.who ?? m)} ${parts.join(' · ')}`);
    }
  }
  if (nicks.length) {
    lines.push('**ตั้งชื่อใน Discord ตามเว็บทีม SAMO:**');
    // The OLD name as text: after the rename <@id> renders the NEW one.
    for (const n of nicks) lines.push(`• ${nameText(n.to)} ← เดิม ${nameText(n.from ?? n.shown)}`);
  }
  if (nickHeld.length) {
    lines.push('**ตั้งชื่อไม่ได้ (ต้องแก้ในเว็บหรือให้แอดมินเปลี่ยนเอง):**');
    for (const h of nickHeld.slice(0, 30)) lines.push(`• ${nameText(h.shown ?? h.member)} — ${h.why}`);
    if (nickHeld.length > 30) lines.push(`• …และอีก ${nickHeld.length - 30} คน`);
  }
  if (held.length) {
    lines.push('**⏸ รอคนตรวจ (ยังไม่ได้ทำ):**');
    for (const h of held.slice(0, 15)) lines.push(`• ${h.member ? `${nameText(h.who ?? h.member)} ` : ''}${h.role ? `<@&${h.role}> ` : ''}— ${h.why}`);
    if (held.length > 15) lines.push(`• …และอีก ${held.length - 15} รายการ`);
  }
  const out = []; let cur = '';
  for (const raw of lines) {
    const l = raw.length > 1900 ? `${raw.slice(0, 1890)}…` : raw;   // one line alone must fit too
    if ((cur + '\n' + l).length > 1900) { out.push(cur); cur = l; } else cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) out.push(cur);
  return out;
}
