#!/usr/bin/env node
// ============================================================
// discord-report.mjs — phase 2 of docs/DISCORD-ROLE-SYNC.md. READ ONLY.
//
// Answers the question the owner actually asked — *"many people's Discord roles
// do not match their ทีม SAMO position, how many?"* — and answers it with a
// number instead of an impression. For every guild member it prints who they
// are in ทีม SAMO, which mirrored roles they SHOULD hold, which they DO hold,
// what WOULD be added, what WOULD be removed, and which roles were left alone
// because nothing manages them.
//
// ⛔ IT WRITES NOTHING, AND THAT IS ENFORCED RATHER THAN INTENDED. There is no
// POST, PUT, PATCH or DELETE in this file; `src/js/discord-report.test.js`
// asserts it, with a control. A report you can accidentally run in apply mode
// is not a report — and phase 3 is a SEPARATE file for the same reason.
//
// ⛔ WHY THIS IS A tools/*.mjs AND NOT THE BOT. The report needs two REST calls
// and no gateway connection, so it needs no `discord.py`, no venv and no
// systemd unit — none of §8b's Python-in-a-JS-repo cost arrives until phase 4's
// live updates. It is tooling, like the twenty files beside it. The resident
// bot remains the §8b decision; this does not quietly re-make it.
//
// ⛔ THE TWO CREDENTIALS LIVE IN DIFFERENT PLACES ON PURPOSE, so this runs in
// two halves and neither secret ever travels:
//
//   --fetch <out.json>   needs DISCORD_TOKEN. Runs ON THE VM, where the token
//                        lives. Touches no database.
//   --report <in.json>   needs the Supabase credentials. Runs on a maintainer's
//                        machine. Touches no Discord.
//
// Run with both present and it does both. Moving the guild dump between them is
// safe: it holds ids and role names, no credential. Copying the TOKEN to the
// machine that has the database is the move that leaked it three times.
//
//   ssh samo-vm 'sudo -E node … --fetch /tmp/guild.json'   # or --whoami first
//   scp samo-vm:/tmp/guild.json /tmp/ && node tools/discord-report.mjs --report /tmp/guild.json
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv, resolveTarget, runSql } from './env-lib.mjs';

const API = 'https://discord.com/api/v10';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] ?? true); };

// ── Discord ────────────────────────────────────────────────────────────────
// Only GET. Every call goes through here so there is ONE place a reviewer has
// to read to believe the "writes nothing" claim.
async function get(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
  if (r.status === 429) {
    const wait = Number(r.headers.get('retry-after') || 1);
    console.error(`  rate limited, waiting ${wait}s`);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
    return get(path, token);
  }
  if (!r.ok) {
    const body = await r.text();
    // 401 vs 403 vs 50001 are three different mistakes and they are easy to
    // confuse at 11pm. Say which one, because the remedies are unrelated.
    if (r.status === 401) throw new Error('401 — the token is wrong or was reset after this file was written');
    if (r.status === 403) throw new Error('403 — the bot lacks permission for this call');
    throw new Error(`HTTP ${r.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function fetchGuild(token) {
  const me = await get('/users/@me', token);
  const guilds = await get('/users/@me/guilds', token);
  if (!guilds.length) throw new Error('the bot is in no guild — invite it first (§7 step 3)');

  let guildId = process.env.DISCORD_GUILD_ID || flag('--guild');
  if (!guildId && guilds.length === 1) guildId = guilds[0].id;
  if (!guildId) {
    throw new Error(`the bot is in ${guilds.length} guilds — pass --guild <id>:\n`
      + guilds.map((g) => `    ${g.id}  ${g.name}`).join('\n'));
  }
  const guild = guilds.find((g) => g.id === guildId) || { id: guildId, name: '(unknown)' };
  const roles = await get(`/guilds/${guildId}/roles`, token);

  // Paginated. `after` is a snowflake cursor, NOT an offset — Discord caps a
  // page at 1000 and a server this size needs one or two rounds.
  const members = [];
  let after = '0';
  for (;;) {
    const page = await get(`/guilds/${guildId}/members?limit=1000&after=${after}`, token);
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }

  return {
    fetched_at: new Date().toISOString(),
    bot: { id: me.id, username: me.username },
    guild: { id: guild.id, name: guild.name },
    // Only what the report needs. A dump holding message content or emails
    // would be a new disclosure surface for the sake of a convenience.
    roles: roles.map((r) => ({ id: r.id, name: r.name, position: r.position, managed: !!r.managed })),
    members: members.map((m) => ({
      id: m.user.id,
      display: m.nick || m.user.global_name || m.user.username,
      roles: m.roles,
      bot: !!m.user.bot,
    })),
  };
}

// ── The portal's half ──────────────────────────────────────────────────────
// discord_role_targets() is the ONE function that decides what a person is due
// (0184). Nothing is recomputed here — a second copy of that rule in JS is this
// repo's most expensive shape.
async function loadTargets() {
  const target = resolveTarget(loadEnv());
  const rows = (q) => runSql(q, target).then(JSON.parse);
  const [targets, ticked, links] = await Promise.all([
    rows('select * from public.discord_role_targets();'),
    rows(`select id, name, discord_role_id from public.team_nodes
           where discord_role order by name;`),
    rows('select count(*)::int as n from public.discord_links;'),
  ]);
  return { targets, ticked, links: links[0].n, project: target.ref };
}

// ── The report ─────────────────────────────────────────────────────────────
function report(guild, db) {
  const roleName = new Map(guild.roles.map((r) => [r.id, r.name]));
  const mapped = new Set(db.ticked.map((t) => t.discord_role_id).filter(Boolean));
  const byUser = new Map(db.targets.map((t) => [t.discord_user_id, t]));
  const out = [];
  const say = (s = '') => out.push(s);

  const humans = guild.members.filter((m) => !m.bot);
  say(`GUILD    ${guild.guild.name}  ·  ${humans.length} people, ${guild.members.length - humans.length} bots, ${guild.roles.length} roles`);
  say(`PORTAL   ${db.ticked.length} nodes ticked for a Discord role, ${mapped.size} provisioned, ${db.links} people linked`);
  say(`READ AT  ${guild.fetched_at}  ·  project ${db.project}`);
  say();

  // §1 the managed set. Everything not in it is untouchable BY CONSTRUCTION —
  // there is no exclusion list to forget to update.
  const unmanaged = guild.roles.filter((r) => !mapped.has(r.id) && r.name !== '@everyone');
  say(`MANAGED ROLES (the ONLY ones a sync may ever remove): ${mapped.size}`);
  say(`UNMANAGED, never touched: ${unmanaged.length}` + (unmanaged.length
    ? ` — ${unmanaged.slice(0, 8).map((r) => r.name).join(', ')}${unmanaged.length > 8 ? ', …' : ''}` : ''));
  say();

  // §2 what the owner still owes: ticked, but no Discord role exists for it.
  const pending = db.ticked.filter((t) => !t.discord_role_id);
  if (pending.length) {
    say(`PENDING PROVISION — ticked in ทีม SAMO, no Discord role yet: ${pending.length}`);
    say(`  ${pending.slice(0, 12).map((p) => p.name).join(' · ')}${pending.length > 12 ? ' …' : ''}`);
    say();
  }

  // §3 the diff, per linked person.
  // ⛔ "CORRECT" AND "NOTHING TO COMPARE" ARE NOT THE SAME ANSWER, and the
  // first version of this section reported them as one.
  //
  // With nothing provisioned, `should` and `has` are both empty for everybody,
  // so every linked person fell into the exact-match bucket and the report
  // announced "LINKED AND CORRECT: 1" about a person who is due FOUR roles and
  // holds none of them. That is the aggregate trap in
  // docs/mistakes/tooling-proofs.md — an extreme value nobody printed the rows
  // behind — and it is the worst possible direction for it to fail in, because
  // "correct" is what somebody reads before deciding to apply.
  //
  // A person with ticked-but-unprovisioned nodes is WAITING, not correct.
  let add = 0; let rm = 0; let exact = 0;
  const lines = []; const waiting = [];
  for (const m of humans) {
    const t = byUser.get(m.id);
    if (!t) continue;
    const has = new Set(m.roles.filter((r) => mapped.has(r)));
    const should = new Set(t.role_ids || []);
    const toAdd = [...should].filter((r) => !has.has(r));
    const toRemove = [...has].filter((r) => !should.has(r));
    const due = t.pending || [];
    if (!toAdd.length && !toRemove.length) {
      if (due.length) {
        waiting.push(`  ${m.display}  (${t.placements} ตำแหน่ง) — due ${due.length}: ${due.join(' · ')}`);
      } else {
        exact++;
      }
      continue;
    }
    add += toAdd.length; rm += toRemove.length;
    lines.push(`  ${m.display}  (${t.placements} ตำแหน่ง)`
      + (toAdd.length ? `\n      + ${toAdd.map((r) => roleName.get(r) || r).join(', ')}` : '')
      + (toRemove.length ? `\n      − ${toRemove.map((r) => roleName.get(r) || r).join(', ')}` : '')
      + (due.length ? `\n      … and ${due.length} more once provisioned: ${due.join(' · ')}` : ''));
  }
  say(`LINKED, CORRECT, NOTHING OUTSTANDING: ${exact}`);
  say(`LINKED AND MISMATCHED: ${lines.length}  (${add} role(s) would be added, ${rm} removed)`);
  lines.slice(0, 40).forEach((l) => say(l));
  if (lines.length > 40) say(`  … ${lines.length - 40} more`);
  if (waiting.length) {
    say(`LINKED BUT WAITING ON PROVISIONING: ${waiting.length}`);
    say('  Their ตำแหน่ง are ticked and the Discord role does not exist yet, so');
    say('  there is nothing to compare. This is NOT "correct".');
    waiting.slice(0, 20).forEach((l) => say(l));
    if (waiting.length > 20) say(`  … ${waiting.length - 20} more`);
  }
  say();

  // §4 the bottleneck, stated as a number rather than left to be inferred.
  const unlinked = humans.filter((m) => !byUser.has(m.id));
  say(`NOT LINKED: ${unlinked.length} of ${humans.length} people in the server have no ทีม SAMO identity.`);
  if (unlinked.length) {
    say('  Until they link, the sync can say nothing about them — and it must NOT');
    say('  read that silence as "remove their roles" (§5e: never act on absence).');
  }

  // §5 ADOPT OR CREATE — what provisioning would have to do, per ticked node.
  //
  // This is the section phase 3 cannot start without. 183 roles already exist
  // and 107 nodes are ticked, so the naive provisioning — create a role for
  // every tick — would DOUBLE most of the server and orphan every existing
  // role's channel overwrites. The alternative is to adopt the role that is
  // already there, which is safe only where the name resolves to exactly one.
  //
  // ⛔ The ambiguous bucket is the six-เหรัญญิก problem arriving from the other
  // direction. Adopting by name where the name is not unique is precisely the
  // bug this design exists to prevent, so those are listed for a human and
  // never resolved by a rule.
  const byName = new Map();
  for (const r of guild.roles) {
    if (r.name === '@everyone' || r.managed) continue;
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  // ⛔ NEAR MATCHES — a rename that an EXACT match cannot see.
  //
  // The owner asked the question that found this: "if a channel is attached to
  // role A and role A isn't in ทีม SAMO because it got renamed, does that person
  // lose access?" The loss is not where it looks. Adoption stores a snowflake,
  // so a rename AFTER adoption is safe — the bot renames that same role object
  // and its channel overwrites follow it. The damage happens BEFORE adoption:
  // a name that no longer matches falls into CREATE, so a brand-new role with
  // NO channel permissions is made beside the real one, and the members given it
  // gain nothing while the old role quietly keeps working.
  //
  // Measured on this server: 4 of 57 "new" roles are renames, covering 26
  // people — `ฝ่าย ComArt (Communication Art)` (16 members) would have been
  // duplicated as an empty `ฝ่าย COMART`.
  //
  // ⛔ THIS DETECTS, IT DOES NOT ADOPT. Normalising away emoji, brackets and
  // the ฝ่าย prefix is a heuristic, and a heuristic that silently BINDS a role
  // is how the wrong เหรัญญิก gets somebody else's channels. It goes in front of
  // a human, in the same bucket as an ambiguous name.
  const norm = (x) => x
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200B-\u200D]/gu, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/^ฝ่าย\s*/, '')
    .replace(/\s+/g, '')
    .toLowerCase().trim();
  const byNorm = new Map();
  for (const r of guild.roles) {
    if (r.name === '@everyone' || r.managed) continue;
    const k = norm(r.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(r);
  }

  const adopt = []; const ambiguous = []; const create = []; const near = [];
  for (const t of db.ticked) {
    if (t.discord_role_id) continue;
    const hits = byName.get(t.name) || [];
    if (hits.length === 1) { adopt.push(t.name); continue; }
    if (hits.length > 1) { ambiguous.push(`${t.name} ×${hits.length}`); continue; }
    const close = byNorm.get(norm(t.name)) || [];
    if (close.length === 1) {
      const held = humans.filter((m) => m.roles.includes(close[0].id)).length;
      near.push([t.name, close[0].name, held]);
    } else {
      create.push(t.name);
    }
  }
  say();
  say(`PROVISIONING PLAN for the ${pending.length} pending node(s):`);
  say(`  ADOPT an existing role (name matches exactly one): ${adopt.length}`);
  say(`  CREATE a new role (no role of that name):          ${create.length}`);
  say(`  AMBIGUOUS — a human must choose:                   ${ambiguous.length}`);
  if (ambiguous.length) say(`      ${ambiguous.join(' · ')}`);
  say(`  NEAR MATCH — probably a RENAME, confirm by hand:    ${near.length}`);
  for (const [node, role, held] of near) {
    say(`      ทีม SAMO "${node}"`);
    say(`         ≈ Discord "${role}"  (${held} member(s) today)`);
  }
  if (near.length) {
    say('      ⛔ Creating these instead of adopting them makes an EMPTY role');
    say('         beside the one holding the channel permissions. Nobody is');
    say('         locked out — the old role keeps working — but the new role');
    say('         grants nothing, which looks like the sync being broken.');
  }
  if (create.length) say(`      to create: ${create.slice(0, 10).join(' · ')}${create.length > 10 ? ' …' : ''}`);

  // ⛔ ADOPTION IMPACT — the number the owner asks for, and the one moment their
  // existing Discord configuration becomes reachable at all.
  //
  // Adopting a role changes NOTHING about the role: same name, colour,
  // position, permissions, and every channel overwrite attached to it. What it
  // changes is that the sync may now decide WHO HOLDS IT. So the honest measure
  // of "what am I agreeing to" is not the role count — it is how many role
  // grants, across how many people, come under management the moment you adopt.
  //
  // It is stated here rather than reasoned about later because the first apply
  // run is exactly when somebody wants this figure and does not have it.
  const adoptedIds = new Set();
  for (const t of db.ticked) {
    if (t.discord_role_id) { adoptedIds.add(t.discord_role_id); continue; }
    const hits = byName.get(t.name) || [];
    if (hits.length === 1) adoptedIds.add(hits[0].id);
  }
  const heldBy = humans.filter((m) => m.roles.some((r) => adoptedIds.has(r)));
  const grants = humans.reduce((n, m) => n + m.roles.filter((r) => adoptedIds.has(r)).length, 0);
  say();
  say(`ADOPTION IMPACT — what comes under management if you adopt all ${adoptedIds.size}:`);
  say(`  ${grants} role grant(s) across ${heldBy.length} of ${humans.length} people.`);
  say('  The ROLES are untouched — name, colour, position, permissions and every');
  say('  channel overwrite stay exactly as they are, and the bot never deletes a');
  say('  role object. What becomes managed is WHO HOLDS THEM.');
  if (db.links === 0 && grants > 0) {
    say(`  ⛔ AND NOBODY IS LINKED, so a naive apply would read all ${grants} as`);
    say('     "should not hold this" and strip them. §5e is what forbids that: an');
    say('     unlinked person is UNKNOWN, never "entitled to nothing". Link first.');
  }

  // Discord roles that no ticked node claims. Some are legitimately unmanaged
  // (moderators, integrations); some are leftovers the old bot created on a
  // rename and never cleaned up, since it had no removal path at all.
  const claimed = new Set(db.ticked.map((t) => t.name));
  const orphans = [...byName.keys()].filter((n) => !claimed.has(n));
  say(`  Discord roles no ticked node claims:               ${orphans.length}`);

  // The old bot is a role in the list until it is kicked. Worth saying out
  // loud: §7 step 5 is what actually closes the leaked-credential exposure.
  const oldBot = guild.roles.find((r) => /role assignment bot/i.test(r.name));
  if (oldBot) {
    say();
    say('⚠️  THE OLD BOT IS STILL IN THIS SERVER — its role is still in the list.');
    say('   §7 step 5: kick it and delete its application. That, not a token');
    say('   reset, is what removes the old credential\'s access to your server.');
  }

  // §6 the refusal, if this were an apply run.
  const touched = add + rm;
  const pct = humans.length ? Math.round((lines.length / humans.length) * 100) : 0;
  say();
  say(`BLAST RADIUS: ${touched} role change(s) across ${lines.length} member(s) — ${pct}% of the server.`);
  if (rm > 50 || pct > 25) {
    say('⛔ An apply run would REFUSE this without an explicit flag. Yearly turnover');
    say('   must be a decision, not 400 quiet removals.');
  }
  return out.join('\n');
}

// ── main ───────────────────────────────────────────────────────────────────
const fetchTo = flag('--fetch');
const reportFrom = flag('--report');

try {
  if (flag('--whoami')) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('DISCORD_TOKEN is not set in this environment');
    const me = await get('/users/@me', token);
    const guilds = await get('/users/@me/guilds', token);
    console.log(`bot: ${me.username} (${me.id})`);
    console.log(`guilds: ${guilds.length}`);
    guilds.forEach((g) => console.log(`  ${g.id}  ${g.name}`));
    process.exit(0);
  }

  let guild = null;
  if (reportFrom && typeof reportFrom === 'string' && !fetchTo) {
    guild = JSON.parse(readFileSync(reportFrom, 'utf8'));
  } else {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      console.error('DISCORD_TOKEN is not set.\n'
        + '  On the VM it is in /etc/samo-discord-bot.env — run with `sudo -E` after sourcing it.\n'
        + '  On a laptop it is NOT available and must not be copied there: fetch on the VM with\n'
        + '  --fetch /tmp/guild.json, scp the file, then --report it here.');
      process.exit(1);
    }
    guild = await fetchGuild(token);
    if (typeof fetchTo === 'string') {
      writeFileSync(fetchTo, JSON.stringify(guild, null, 2));
      console.log(`wrote ${fetchTo} — ${guild.members.length} members, ${guild.roles.length} roles`);
      if (!reportFrom) process.exit(0);
    }
  }
  console.log(report(guild, await loadTargets()));
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
