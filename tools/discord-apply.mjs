#!/usr/bin/env node
// ============================================================
// discord-apply.mjs — phase 3 of docs/DISCORD-ROLE-SYNC.md. THE ONE THAT WRITES.
//
// It adds and removes MIRRORED Discord roles so a linked person's roles match
// what ทีม SAMO says they hold. Everything it needs to decide comes from
// `public.discord_role_targets()` (0184) — the ONE function that computes a
// target set. Nothing is recomputed here; a second copy of that rule in JS is
// this repo's most expensive shape (.claude/rules/mistakes.md class 6).
//
// ⛔ A SEPARATE FILE FROM THE REPORT AND FROM PROVISIONING, deliberately.
//   discord-report.mjs     is guarded to contain no HTTP verb but GET.
//   discord-provision.mjs  is guarded to contain no DELETE at all.
// Both guarantees are worth having, and an --apply flag bolted onto either
// would delete it for everyone. This file is where the writes live, and the
// guards on it are different ones (src/js/discord-apply.test.js).
//
// ⛔ IT PLANS BY DEFAULT, and `--apply` must carry the counts the operator just
// read — the same refusal provisioning uses:
//
//     node tools/discord-apply.mjs                          # plan only
//     node tools/discord-apply.mjs --apply --add 4 --remove 0
//     node tools/discord-apply.mjs --only <discord-user-id> # one person first
//
// The plan is RECOMPUTED at apply time and re-printed. If it no longer matches
// the numbers passed, it refuses. An --apply that recomputes and proceeds
// silently is an --apply that can do something nobody ever saw.
//
// ⛔ THE THREE REFUSALS THAT ARE NOT POLITENESS
//
//   1. AN EMPTY TARGET SET IS NEVER A DIFF. discord_role_targets() is SECURITY
//      INVOKER, so "no rows" means EITHER "nobody is linked" OR "this caller
//      cannot see team_nodes" — and to a reconcile those are the same input,
//      which looks exactly like "remove every mirrored role from everybody".
//      That is class 2 (an unresolvable reference failing OPEN). It refuses.
//   2. NEVER ACT ON ABSENCE (§5e). A guild member with no link is UNKNOWN, not
//      "entitled to nothing". They are never in the plan at all.
//   3. THE BLAST-RADIUS CAP (§5e). Yearly turnover must be a decision, not 400
//      quiet removals. Checked BEFORE the first write, never caught after.
//
// ⛔ IT CANNOT DELETE A ROLE OBJECT. The only path it may mutate is
//    /guilds/{g}/members/{u}/roles/{r} — one member, one role. Deleting a role
//    takes its channel permission overwrites with it, irreversibly, and the
//    role that looks unused is the one gating a channel nobody opened this
//    month. There is no flag for it and no code path to it.
//
// ⛔ AND IT CHECKS THE STEP THAT FAILS SILENTLY. A bot can only manage roles
//    BELOW its own highest role — Administrator does not exempt it, only the
//    guild owner is exempt — and Discord reports success and changes nothing.
//    §7 step 4 is the drag that fixes it. This tool refuses instead of
//    reporting a successful run that did nothing.
//
// Runs ON THE VM, the only place with both credentials:
//   DISCORD_TOKEN                 /etc/samo-discord-bot.env
//   SUPABASE_URL + SERVICE_ROLE   /etc/samo-notify.env
// ============================================================
// ⛔ THE BASE IS OVERRIDABLE ONLY TO LOOPBACK, and that restriction is the
// whole point of the override existing at all.
//
// src/js/discord-apply.run.test.js runs this file as a real child process
// against a stub Discord + PostgREST server and asserts which HTTP calls come
// out — the only way to prove the PUT and the DELETE name the right member and
// the right role, which no amount of reading the source can. That test needs to
// redirect the base.
//
// But THIS PROCESS HOLDS THE BOT TOKEN, and an env var that can point it at an
// arbitrary host is a credential-exfiltration path — a token this project has
// already lost three times, each one a copy in transit. So the override is
// honoured only for 127.0.0.1, which cannot leave the machine. Anything else is
// ignored SILENTLY in favour of the real API: refusing loudly would turn a
// typo into an outage, and accepting it would turn a typo into a leak.
const API = (() => {
  const o = process.env.DISCORD_API_BASE;
  return o && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(o)
    ? o
    : 'https://discord.com/api/v10';
})();
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
const num = (f) => { const i = args.indexOf(f); return i < 0 ? null : Number(args[i + 1]); };

// ── §5e's cap, as two numbers with names ───────────────────────────────────
// Removal is the direction that destroys access, so it gets the tighter bound.
// MAX_PERCENT is of the HUMANS in the guild, not of the linked people: one
// linked person is 100% of the linked set and 0.5% of the server, and it is
// the server that a mistake is measured against.
const MAX_REMOVALS = 50;
const MAX_PERCENT = 25;

// Discord permission bits. MANAGE_ROLES is the one that matters; ADMINISTRATOR
// implies it but does NOT exempt the hierarchy check below.
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

const env = process.env;
const need = (n) => {
  if (!env[n]) {
    console.error(`✗ ${n} is not set — source /etc/samo-discord-bot.env and /etc/samo-notify.env.`);
    console.error('  This tool runs ON THE VM. Do not copy the Discord token to a laptop:');
    console.error('  that is the move that leaked this credential three times.');
    process.exit(1);
  }
  return env[n];
};

// ── The ONLY path this tool may mutate ─────────────────────────────────────
// One member, one role. Every write goes through this template, so "it cannot
// delete a role object" is checkable by reading one line rather than trusting a
// grep over the whole file. src/js/discord-apply.test.js asserts that no
// mutating call uses any other path.
const MEMBER_ROLE = (g, u, r) => `/guilds/${g}/members/${u}/roles/${r}`;

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
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    if (r.status === 403) {
      throw new Error(`403 on ${init.method || 'GET'} ${path} — the bot lacks permission, or the role `
        + `sits ABOVE it in the role list (§7 step 4). ${body}`);
    }
    throw new Error(`HTTP ${r.status} ${init.method || 'GET'} ${path}: ${body}`);
  }
  return r.status === 204 ? null : r.json();
}

// ── Postgres, over PostgREST with the service key ──────────────────────────
// No arbitrary SQL, which is why this works from the VM at all: the PAT that
// runs SQL is maintainer-only and must never be copied here.
async function pg(path, init = {}) {
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${need('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

async function fetchMembers(guildId) {
  const out = [];
  let after = '0';
  for (;;) {
    const page = await dc(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    out.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return out;
}

// ── The preflight that turns a silent no-op into a refusal ─────────────────
// §7 step 4 is the step that "silently breaks everything": a bot below the
// roles it manages reports success and changes nothing. Administrator does not
// exempt it. So this is checked against the role LIST, before any write, and
// only for the roles the plan would actually touch — a mirrored role nobody is
// gaining or losing today should not block a correct run.
function hierarchy(botMember, roles, touchedIds) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const mine = botMember.roles.map((id) => byId.get(id)).filter(Boolean);
  const top = mine.reduce((n, r) => Math.max(n, r.position), -1);
  const perms = mine.reduce((acc, r) => acc | BigInt(r.permissions || '0'), 0n);
  const canManage = (perms & MANAGE_ROLES) !== 0n || (perms & ADMINISTRATOR) !== 0n;
  const above = [...touchedIds]
    .map((id) => byId.get(id))
    .filter((r) => r && r.position >= top);
  return { top, canManage, above };
}

async function main() {
  const guilds = await dc('/users/@me/guilds');
  const guildId = env.DISCORD_GUILD_ID || (guilds.length === 1 ? guilds[0].id : null);
  if (!guildId) throw new Error(`bot is in ${guilds.length} guilds — set DISCORD_GUILD_ID`);
  const me = await dc('/users/@me');

  const [roles, members, botMember] = await Promise.all([
    dc(`/guilds/${guildId}/roles`),
    fetchMembers(guildId),
    dc(`/guilds/${guildId}/members/${me.id}`),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const humans = members.filter((m) => !m.user.bot);

  // ── What the portal says ────────────────────────────────────────────────
  // The managed set is DERIVED from the node → role mapping (§5d), never from
  // a name prefix and never from an exclusion list, which cannot see the role
  // somebody adds next month. Everything outside it is untouchable BY
  // CONSTRUCTION rather than by remembering.
  const ticked = await pg('team_nodes?select=id,name,discord_role_id&discord_role=is.true&order=name');
  const managed = new Set(ticked.map((t) => t.discord_role_id).filter(Boolean));
  const targets = await pg('rpc/discord_role_targets', { method: 'POST', body: '{}' });

  console.log(`GUILD    ${guildId}  ·  ${humans.length} people, ${roles.length} roles`);
  console.log(`BOT      ${me.username} (${me.id})`);
  console.log(`PORTAL   ${ticked.length} ticked node(s), ${managed.size} provisioned, ${targets.length} linked person(row)s`);
  console.log();

  // ⛔ REFUSAL 1 — an empty target set is never a diff.
  if (!targets.length) {
    console.error('✗ REFUSED — discord_role_targets() returned NO ROWS.');
    console.error('  That means EITHER nobody is linked OR this credential cannot read');
    console.error('  team_nodes. Those are indistinguishable here, and both look exactly');
    console.error('  like "remove every mirrored role from everybody" (§5e, class 2).');
    console.error('  Nothing was written. Check the link count before re-running.');
    process.exit(1);
  }

  const byUser = new Map(targets.map((t) => [t.discord_user_id, t]));
  const only = val('--only');

  // ── The diff ────────────────────────────────────────────────────────────
  const plan = [];       // [member, toAdd[], toRemove[]]
  const leavers = [];    // linked, but zero placements — owner-blocked, see below
  const waiting = [];    // ticked node with no Discord role yet — nothing to compare
  const missing = new Set(); // mapped to a role id the guild no longer has
  let add = 0; let remove = 0;

  for (const m of humans) {
    const t = byUser.get(m.user.id);
    // ⛔ REFUSAL 2 — never act on absence. An unlinked member is UNKNOWN. They
    // are not "entitled to nothing"; they are not in the plan at all.
    if (!t) continue;
    if (only && m.user.id !== only) continue;

    const display = m.nick || m.user.global_name || m.user.username;

    // ⛔ A LEAVER IS NOT A DIFF EITHER — NOT YET. §5e says a person who resolves
    // to no current placement keeps a `ศิษย์เก่า SAMO` role rather than being
    // stripped bare, because a member with zero roles is indistinguishable from
    // one the bot failed to match. WHAT MAKES SOMEONE A LEAVER IS UNDECIDED
    // (HANDOFF §14b item 4) and so is the alumni role, so this tool reports
    // them and touches nothing. Stripping them on a guess is the one removal
    // that cannot be undone by re-running.
    if (t.placements === 0) {
      const held = m.roles.filter((r) => managed.has(r));
      if (held.length) leavers.push(`  ${display} — holds ${held.map((r) => roleName.get(r) || r).join(', ')}`);
      continue;
    }

    const should = (t.role_ids || []).filter((r) => {
      if (roleName.has(r)) return true;
      missing.add(r);
      return false;
    });
    const shouldSet = new Set(should);
    const held = m.roles.filter((r) => managed.has(r));
    const toAdd = should.filter((r) => !m.roles.includes(r));
    const toRemove = held.filter((r) => !shouldSet.has(r));

    if ((t.pending || []).length) {
      waiting.push(`  ${display} — due ${t.pending.length} more once provisioned: ${t.pending.join(' · ')}`);
    }
    if (!toAdd.length && !toRemove.length) continue;
    add += toAdd.length; remove += toRemove.length;
    plan.push([m, toAdd, toRemove, display]);
  }

  if (missing.size) {
    console.log(`⚠️  ${missing.size} mapped role id(s) do not exist in this guild any more —`);
    console.log('   a role was deleted in Discord after being adopted. They are SKIPPED,');
    console.log('   not created: re-run provisioning to remap those nodes.');
    console.log();
  }

  const pct = humans.length ? Math.round((plan.length / humans.length) * 100) : 0;
  console.log(`PLAN: ${add} role(s) to add, ${remove} to remove, across ${plan.length} of ${humans.length} people (${pct}%).`);
  for (const [, toAdd, toRemove, display] of plan.slice(0, 60)) {
    console.log(`  ${display}`);
    if (toAdd.length) console.log(`      + ${toAdd.map((r) => roleName.get(r) || r).join(', ')}`);
    if (toRemove.length) console.log(`      − ${toRemove.map((r) => roleName.get(r) || r).join(', ')}`);
  }
  if (plan.length > 60) console.log(`  … ${plan.length - 60} more`);

  if (waiting.length) {
    console.log();
    console.log(`WAITING ON PROVISIONING: ${waiting.length} — ticked in ทีม SAMO, no Discord role yet.`);
    console.log('  Nothing to compare for those ตำแหน่ง. This is NOT "correct".');
    waiting.slice(0, 10).forEach((l) => console.log(l));
  }
  if (leavers.length) {
    console.log();
    console.log(`LEAVERS — linked, but ZERO ตำแหน่ง in ทีม SAMO: ${leavers.length}`);
    console.log('  ⛔ NOT TOUCHED, on purpose. §5e wants a ศิษย์เก่า SAMO role rather than');
    console.log('     a stripped member, and both "what makes a leaver" and that role are');
    console.log('     the owner\'s undecided call (HANDOFF §14b item 4).');
    leavers.slice(0, 20).forEach((l) => console.log(l));
  }

  const unlinked = humans.filter((m) => !byUser.has(m.user.id)).length;
  console.log();
  console.log(`NOT LINKED: ${unlinked} of ${humans.length} — untouched, and never read as "remove everything".`);

  // ── The preflight ───────────────────────────────────────────────────────
  const touched = new Set();
  for (const [, toAdd, toRemove] of plan) { toAdd.forEach((r) => touched.add(r)); toRemove.forEach((r) => touched.add(r)); }
  const h = hierarchy(botMember, roles, touched);
  console.log();
  console.log(`BOT POSITION: highest role at position ${h.top}; Manage Roles: ${h.canManage ? 'yes' : 'NO'}.`);
  if (h.above.length) {
    console.log(`⛔ ${h.above.length} role(s) in this plan sit AT OR ABOVE the bot — it cannot`);
    console.log('   change them, and Discord would report success while changing nothing:');
    h.above.forEach((r) => console.log(`      ${r.name} (position ${r.position})`));
    console.log('   Fix: Server Settings → Roles → drag the bot ABOVE them (§7 step 4).');
  }

  // ── The cap ─────────────────────────────────────────────────────────────
  // ⛔ REFUSAL 3, and it is checked HERE — before the first write, not caught
  // as an error part way through a run that has already stripped 200 people.
  const oversized = remove > MAX_REMOVALS || pct > MAX_PERCENT;
  if (oversized) {
    console.log();
    console.log(`⛔ BLAST RADIUS: ${remove} removal(s) (cap ${MAX_REMOVALS}) across ${pct}% of the server (cap ${MAX_PERCENT}%).`);
    console.log('   Yearly turnover must be a DECISION, not 400 quiet removals. Read the');
    console.log('   plan above, and if it is right, add --allow-large.');
  }

  if (!has('--apply')) {
    console.log();
    console.log('PLAN ONLY — nothing was written.');
    console.log(`    node tools/discord-apply.mjs --apply --add ${add} --remove ${remove}`
      + (oversized ? ' --allow-large' : '') + (only ? ` --only ${only}` : ''));
    console.log('  ⚠️  Run it on ONE person first: --only <discord-user-id>.');
    return;
  }

  // The plan the operator read must be the plan that runs. It is recomputed
  // above on every invocation, so these numbers are compared against a FRESH
  // diff, never against the one printed minutes ago.
  if (num('--add') !== add || num('--remove') !== remove) {
    console.error('\n✗ REFUSED — the plan changed since you read it.');
    console.error(`  you passed  --add ${num('--add')} --remove ${num('--remove')}`);
    console.error(`  now         --add ${add} --remove ${remove}`);
    console.error('  Re-read the plan above and pass the new numbers if they are right.');
    process.exit(1);
  }
  if (oversized && !has('--allow-large')) {
    console.error('\n✗ REFUSED — over the blast-radius cap without --allow-large.');
    process.exit(1);
  }
  if (!h.canManage) {
    console.error('\n✗ REFUSED — the bot does not hold Manage Roles. Every write would 403.');
    process.exit(1);
  }
  if (h.above.length) {
    console.error('\n✗ REFUSED — some roles in this plan sit at or above the bot in the role');
    console.error('  list. Discord would answer 204 and change nothing, which is the silent');
    console.error('  failure §7 step 4 exists to prevent. Drag the bot above them first.');
    process.exit(1);
  }
  // Belt and braces: nothing outside the managed set may be written, whatever
  // the target function returned. The managed set is derived from the mapping,
  // so this catches a target row that named an unmirrored role.
  const stray = [...touched].filter((r) => !managed.has(r));
  if (stray.length) {
    console.error(`\n✗ REFUSED — ${stray.length} role(s) in the plan are not in the managed`);
    console.error('  mapping. A sync may only ever touch roles a ticked node owns.');
    process.exit(1);
  }

  console.log('\nAPPLYING…');
  // ⛔ URL-ENCODED, AND NOT AS TIDINESS. An HTTP header value is a ByteString
  // (latin-1), so a Thai character makes fetch() throw
  // `Cannot convert argument to a ByteString` BEFORE the request is built —
  // every write would have died on the first PUT. Discord's own docs say this
  // header must be URL-encoded when it is not ASCII.
  //
  // ⚠️ Nothing that runs read-only can see this: the plan path never builds a
  // header. It was found by running the tool against a stub guild
  // (src/js/discord-apply.run.test.js), which is the whole argument for that
  // test existing — the live run said "0 to add, 0 to remove" and exit 0.
  const reason = { 'X-Audit-Log-Reason': encodeURIComponent('ทีม SAMO role sync') };
  let done = 0;
  for (const [m, toAdd, toRemove, display] of plan) {
    for (const r of toAdd) {
      await dc(MEMBER_ROLE(guildId, m.user.id, r), { method: 'PUT', headers: reason });
      console.log(`  + ${display}  ${roleName.get(r) || r}`);
      done++;
      await new Promise((ok) => setTimeout(ok, 400));
    }
    for (const r of toRemove) {
      await dc(MEMBER_ROLE(guildId, m.user.id, r), { method: 'DELETE', headers: reason });
      console.log(`  − ${display}  ${roleName.get(r) || r}`);
      done++;
      await new Promise((ok) => setTimeout(ok, 400));
    }
  }
  console.log(`\n✓ ${done} role change(s) applied across ${plan.length} member(s).`);
  console.log('  Re-run without --apply to confirm the diff is now empty.');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
