#!/usr/bin/env node
// ============================================================
// discord-readiness.mjs — if everybody linked tomorrow, what would happen?
//
// The question this answers is the one nobody could answer without it: the
// report and the apply tool both describe people who ARE linked, and exactly
// one person is. So both are green, both are honest, and neither says whether
// opening this to 342 people would work.
//
// ⛔ IT NEEDS NO DISCORD TOKEN, on purpose, so it runs on a laptop. Everything
// it asks is a question about the PORTAL — who can link, who is due what, which
// ตำแหน่ง can grant anything today — and 0184 put all of that in Postgres
// precisely so it could be answered without a credential. The only thing it
// cannot see is the guild itself; `npm run discord:report` is that half.
//
//   npm run discord:readiness
//
// Exit 0 always: this is a measurement, not a gate. Nothing here is a fault —
// it is a list of what is not done yet, with the number of PEOPLE behind each,
// because "59 nodes unprovisioned" and "219 people would be short a role" are
// the same fact and only one of them is an argument.
// ============================================================
import { loadEnv, resolveTarget, runSql } from './env-lib.mjs';

const target = resolveTarget(loadEnv());
const q = (sql) => runSql(sql, target).then(JSON.parse);

// ⛔ ONE QUERY PER QUESTION, and each names what it counts. A single clever
// query returning a wide row is how "roles to create" and "ticked nodes without
// a role" got confused for each other — 51 and 59, both true, one of them
// wrong in context (docs/mistakes/tooling-proofs.md).
const rows = await q(`
with placed as (
  select distinct person_id from public.team_members where person_id is not null
),
ticked as (
  select n.id, n.kind, n.discord_role_id is not null as provisioned from public.team_nodes n
   where n.discord_role
),
due as (
  select p.person_id,
         count(*) filter (where t.provisioned)     as gettable,
         count(*) filter (where not t.provisioned) as missing
    from placed p
    join public.team_members tm on tm.person_id = p.person_id
    cross join lateral public.discord_node_ancestry(tm.node_id) a
    join ticked t on t.id = a.node_id
   -- 0196: a ตำแหน่ง ABOVE you is not yours; only ฝ่าย are inherited
   where (a.node_id = tm.node_id or t.kind = 'division')
   group by p.person_id
)
select
  (select count(*) from placed)                                          as placed,
  (select count(*) from placed p join public.people pe on pe.id = p.person_id
    where nullif(btrim(coalesce(pe.kkumail,'')),'') is not null)         as can_link,
  (select count(*) from placed p join public.people pe on pe.id = p.person_id
    where nullif(btrim(coalesce(pe.kkumail,'')),'') is null)             as no_kkumail,
  (select count(*) from public.discord_links)                            as linked,
  (select count(*) from ticked)                                          as ticked,
  (select count(*) from ticked where provisioned)                        as provisioned,
  (select count(*) from due where gettable > 0)                          as would_get_something,
  (select count(*) from due where gettable = 0 and missing > 0)          as would_get_nothing,
  (select count(*) from due where missing > 0)                           as short_a_role,
  (select count(*) from public.discord_orphaned_accounts)                as orphaned
`);
const r = rows[0];
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

console.log(`PORTAL   project ${target.ref}\n`);
console.log(`ทีม SAMO holds ${r.placed} people in a ตำแหน่ง.`);
console.log(`  ${r.can_link} can link today — they have a kkumail on file, so signing in`);
console.log(`     resolves them to their ทีม SAMO row (my_person_id matches on EMAIL,`);
console.log(`     not on an account existing beforehand).`);
console.log(`  ${r.no_kkumail} cannot: no kkumail recorded, so a sign-in makes a stranger.`);
console.log(`  ${r.linked} actually linked so far.\n`);

console.log(`ตำแหน่ง ticked for a Discord role: ${r.ticked}`);
console.log(`  ${r.provisioned} can grant something today (${pct(r.provisioned, r.ticked)}).`);
console.log(`  ${r.ticked - r.provisioned} have no Discord role yet, so they grant nothing.\n`);

console.log(`IF EVERY ONE OF THE ${r.placed} LINKED TOMORROW:`);
console.log(`  ${r.would_get_something} would get at least one role  (${pct(r.would_get_something, r.placed)})`);
console.log(`  ${r.would_get_nothing} would get NOTHING although they are owed something`);
console.log(`  ${r.short_a_role} would be short at least one role that does not exist yet`
  + `  (${pct(r.short_a_role, r.placed)})`);
if (r.orphaned) console.log(`  ${r.orphaned} Discord account(s) are orphaned — see the apply tool (0187)`);

// ── What is actually in the way, ordered by how many people it affects ──────
// ⛔ Ordered by PEOPLE, not by how much work each is. A ฝ่าย that is ticked and
// empty is a tidy-up; a ฝ่าย that is ticked, unprovisioned and holds nine
// people is nine people who link and get nothing, which is what they will
// report as "the bot is broken".
const blockers = await q(`
  select n.name,
         (select count(*) from public.team_members tm where tm.node_id = n.id) as direct,
         (select count(distinct tm2.person_id)
            from public.team_members tm2
            cross join lateral public.discord_node_ancestry(tm2.node_id) a
           where a.node_id = n.id
             and (a.node_id = tm2.node_id or n.kind = 'division'))                                             as beneath
    from public.team_nodes n
   where n.discord_role and n.discord_role_id is null
   order by beneath desc, direct desc, n.name
   limit 12
`);
const affecting = blockers.filter((b) => Number(b.beneath) > 0);
console.log(`\nUNPROVISIONED ตำแหน่ง THAT REAL PEOPLE SIT UNDER: ${affecting.length} of the top 12`);
if (!affecting.length) {
  console.log('  none — every ตำแหน่ง with people in it can already grant its role.');
} else {
  for (const b of affecting) {
    console.log(`  ${String(b.beneath).padStart(4)} people   ${b.name}`
      + (Number(b.direct) ? `   (${b.direct} directly)` : ''));
  }
  console.log('  Each of these is somebody who links, is told it worked, and receives');
  console.log('  nothing. Provision these before announcing, not after.');
}

// ── The cheapest thing that fixes the worst outcome ────────────────────────
// ⛔ "CREATE ONLY THE POPULATED ONES" IS NOT A MIDDLE PATH ON THIS DATA — 58 of
// the 59 unprovisioned ตำแหน่ง have people under them, so it saves ONE role. It
// was recommended before it was measured.
//
// The real middle path is different and much cheaper: most people who are short
// a role still GET one, from a ticked ancestor that is already provisioned.
// Only those with NO provisioned ancestor anywhere get zero — and in a tree,
// covering them means creating the node HIGHEST in their ancestry, which covers
// everyone beneath it at once. That is a minimum, not a heuristic.
const cover = await q(`
  with placed as (select distinct person_id from public.team_members where person_id is not null),
  anc as (
    select p.person_id, n.id as node_id, n.name,
           n.discord_role_id is not null as provisioned
      from placed p
      join public.team_members tm on tm.person_id = p.person_id
      cross join lateral public.discord_node_ancestry(tm.node_id) a
      join public.team_nodes n on n.id = a.node_id
     where n.discord_role
       and (a.node_id = tm.node_id or n.kind = 'division')
  ),
  destitute as (
    select person_id from anc group by person_id having bool_and(not provisioned)
  ),
  best as (
    select d.person_id, a.node_id, a.name,
           row_number() over (
             partition by d.person_id
             order by (select count(*) from public.discord_node_ancestry(a.node_id)) asc, a.name
           ) as rank
      from destitute d join anc a on a.person_id = d.person_id
  )
  select b.name, count(*)::int as covers
    from best b where b.rank = 1 group by b.name order by covers desc
`);
if (cover.length) {
  const total = cover.reduce((n, c) => n + Number(c.covers), 0);
  console.log(`\nCHEAPEST FIX FOR THE ${total} WHO WOULD GET NOTHING: `
    + `${cover.length} role(s), not ${r.ticked - r.provisioned}.`);
  for (const c of cover) console.log(`  ${String(c.covers).padStart(4)} people   ${c.name}`);
  console.log('  Everyone else who is short a role still RECEIVES one, from a ticked');
  console.log('  ancestor that is already provisioned. Creating the rest buys precision,');
  console.log('  not access — and it is the difference between spending 1 of the');
  console.log(`  remaining role budget and spending ${r.ticked - r.provisioned}.`);
  console.log('\n  On the VM, plan it first:');
  console.log(`    node tools/discord-provision.mjs --only ${cover.map((c) => `'${c.name}'`).join(',')}`);
} else {
  console.log('\nNobody would get nothing — every placed person has at least one');
  console.log('provisioned ticked ตำแหน่ง in their ancestry.');
}

console.log('\nWhat this CANNOT see: the guild itself — whether the roles exist, who');
console.log('holds what, whether the bot sits above them. That is `npm run discord:report`');
console.log('and `npm run discord:apply`, both of which need the token and run on the VM.');
