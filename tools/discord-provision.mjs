#!/usr/bin/env node
// ============================================================
// discord-provision.mjs — phase 3a. Give every ticked ทีม SAMO node a Discord
// role, by ADOPTING the one that already exists or CREATING one that does not.
//
// ⛔ A SEPARATE FILE FROM THE REPORT, DELIBERATELY. discord-report.mjs is
// guarded to contain no HTTP verb but GET, and that guarantee is worth having.
// A `--apply` flag bolted onto it would delete the guarantee for everyone.
//
// ⛔ IT PLANS BY DEFAULT. `--apply` is required to write anything, and it must
// be accompanied by the COUNTS the operator read in the plan:
//
//     node tools/discord-provision.mjs                       # plan only
//     node tools/discord-provision.mjs --apply --adopt 50 --create 53
//
// If the plan has changed since it was read — somebody ticked a node, somebody
// renamed a role — the numbers disagree and it refuses. That is the whole
// point: the thing that gets applied must be the thing a human looked at. An
// --apply that recomputes and proceeds is an --apply that can do something
// nobody ever saw.
//
// ⛔ IT NEVER DELETES A ROLE, and there is no flag for it. Deleting a Discord
// role takes its channel permission overwrites with it, irreversibly, and the
// role that looks unused is the one holding access to a channel nobody has
// opened this month.
//
// ⛔ IT NEVER AUTO-CREATES FROM THE SYNC PATH. The old bot did (main.py:192),
// which forked a second `ฝ่าย…` role on every rename and orphaned the first
// with all its overwrites still attached. Provisioning is an explicit command a
// person runs, once, having read what it would do.
//
// Runs ON THE VM, because it is the only place that has both credentials:
//   DISCORD_TOKEN                 /etc/samo-discord-bot.env
//   SUPABASE_URL + SERVICE_ROLE   /etc/samo-notify.env
// ============================================================
const API = 'https://discord.com/api/v10';
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f) => { const i = args.indexOf(f); return i < 0 ? null : Number(args[i + 1]); };

// Discord's hard cap. Not a soft limit and not raised by boosting.
const ROLE_CAP = 250;

const env = process.env;
const need = (n) => { if (!env[n]) { console.error(`✗ ${n} is not set — source /etc/samo-discord-bot.env and /etc/samo-notify.env`); process.exit(1); } return env[n]; };

// ── Discord ────────────────────────────────────────────────────────────────
async function dc(path, init = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${need('DISCORD_TOKEN')}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (r.status === 429) {
    const wait = Number(r.headers.get('retry-after') || 1);
    console.error(`  rate limited, waiting ${wait}s`);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
    return dc(path, init);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${init.method || 'GET'} ${path}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

// ── Postgres, over PostgREST with the service key ──────────────────────────
// No arbitrary SQL is needed, which is why this works from the VM at all: the
// PAT that runs SQL is maintainer-only and must never be copied here.
async function pg(path, init = {}) {
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${need('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

const norm = (x) => String(x)
  .replace(/[\p{Extended_Pictographic}️​-‍]/gu, '')
  .replace(/\([^)]*\)/g, '').replace(/^ฝ่าย\s*/, '').replace(/\s+/g, '').toLowerCase().trim();

async function main() {
  const guilds = await dc('/users/@me/guilds');
  const guildId = env.DISCORD_GUILD_ID || (guilds.length === 1 ? guilds[0].id : null);
  if (!guildId) throw new Error(`bot is in ${guilds.length} guilds — set DISCORD_GUILD_ID`);

  const roles = (await dc(`/guilds/${guildId}/roles`)).filter((r) => r.name !== '@everyone' && !r.managed);
  const ticked = await pg('team_nodes?select=id,name,discord_role_id&discord_role=is.true&order=name');

  const byName = new Map(); const byNorm = new Map();
  for (const r of roles) {
    if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r);
    const k = norm(r.name);
    if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(r);
  }

  const already = []; const adopt = []; const create = []; const near = []; const ambiguous = [];
  for (const t of ticked) {
    if (t.discord_role_id) { already.push(t); continue; }
    const exact = byName.get(t.name) || [];
    if (exact.length === 1) { adopt.push([t, exact[0]]); continue; }
    if (exact.length > 1) { ambiguous.push([t, exact]); continue; }
    const close = byNorm.get(norm(t.name)) || [];
    if (close.length === 1) near.push([t, close[0]]); else create.push(t);
  }

  console.log(`GUILD roles: ${roles.length + 1} of ${ROLE_CAP}   (including @everyone)`);
  console.log(`TICKED nodes: ${ticked.length}   already mapped: ${already.length}`);
  console.log(`  ADOPT     ${adopt.length}`);
  console.log(`  CREATE    ${create.length}`);
  console.log(`  NEAR      ${near.length}  (a rename — confirm by hand, never adopted automatically)`);
  console.log(`  AMBIGUOUS ${ambiguous.length}  (the same name on several roles — a human must choose)`);
  for (const [t, rs] of ambiguous) console.log(`      "${t.name}" matches ${rs.length} roles`);
  for (const [t, r] of near) console.log(`      "${t.name}"  ≈  "${r.name}"`);

  // ⛔ THE CAP IS A WALL, NOT A WARNING. Discord refuses role 251 outright, and
  // it refuses it PART WAY THROUGH a run — leaving some nodes mapped and some
  // not, which is the messiest possible state to reason about afterwards. So it
  // is checked BEFORE anything is created, not caught as an error.
  const after = roles.length + 1 + create.length;
  console.log(`\nAFTER CREATING: ${after} of ${ROLE_CAP} roles (${Math.round((after / ROLE_CAP) * 100)}%)`);
  if (after > ROLE_CAP) {
    console.log(`⛔ THAT EXCEEDS DISCORD'S HARD LIMIT OF ${ROLE_CAP}. Untick some nodes, or`);
    console.log('   remove Discord roles nothing uses, before provisioning.');
  } else if (after > ROLE_CAP * 0.85) {
    console.log('⚠️  That is close to the cap, and the cap cannot be raised — not by');
    console.log('   boosting, not by anything. Roles are a finite resource in this');
    console.log('   server, so spend the remaining ones deliberately.');
  }

  if (!has('--apply')) {
    console.log('\nPLAN ONLY — nothing was written. To apply, pass the counts you just read:');
    console.log(`  node tools/discord-provision.mjs --apply --adopt ${adopt.length} --create ${create.length}`);
    return;
  }

  // The plan the operator read must be the plan that runs.
  if (num('--adopt') !== adopt.length || num('--create') !== create.length) {
    console.error(`\n✗ REFUSED — the plan changed since you read it.`);
    console.error(`  you passed  --adopt ${num('--adopt')} --create ${num('--create')}`);
    console.error(`  now         --adopt ${adopt.length} --create ${create.length}`);
    console.error('  Re-read the plan above and pass the new numbers if they are right.');
    process.exit(1);
  }
  if (after > ROLE_CAP) { console.error('\n✗ REFUSED — would exceed the role cap.'); process.exit(1); }

  let n = 0;
  for (const [t, r] of adopt) {
    await pg(`team_nodes?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ discord_role_id: r.id }) });
    console.log(`  adopted  ${t.name}`);
    n++;
  }
  for (const t of create) {
    // No permissions, no colour, not hoisted. Access comes from CHANNEL
    // overwrites, which a human adds deliberately; a role created with
    // permissions of its own grants them server-wide.
    const role = await dc(`/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: t.name, permissions: '0', mentionable: true, hoist: false }),
      headers: { 'X-Audit-Log-Reason': 'ทีม SAMO role sync — provisioning' },
    });
    await pg(`team_nodes?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ discord_role_id: role.id }) });
    console.log(`  created  ${t.name}`);
    n++;
    await new Promise((ok) => setTimeout(ok, 400));   // pace against the rate limit
  }
  console.log(`\n✓ ${n} node(s) mapped. ${near.length} near-match(es) and ${ambiguous.length} ambiguous left for a human.`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
