#!/usr/bin/env node
// ============================================================
// discord-nickname-link.mjs — the ONE-TIME bulk link by nickname (2026-09-19).
//
// WHY THIS EXISTS. Linking is self-service (เชื่อมบัญชี Discord, OAuth2), and
// waiting for 342 people to press it would take a term. The server's nicknames
// already follow `ชื่อเล่น_#ชั้นปี_XXX-X` — the old bot set them — and
// ชื่อเล่น + the last four digits of รหัสนักศึกษา pick out exactly one registry
// person for most members. The owner approved matching them once.
//
// ⛔ A NICKNAME IS THE INPUT HERE, NEVER THE KEY. What is written is the Discord
// user ID, which nobody can edit, so a later rename changes nothing. That is
// the difference from the old bot (DISCORD-ROLE-SYNC.md §3c).
//
// ⛔ WHAT IT WILL NOT DO:
//   · link anything that is not an EXACT, ONE-TO-ONE match — a digits match
//     with a different ชื่อเล่น is printed for a human, and linked only if that
//     human names the Discord id in --confirm;
//   · touch a person or an account that is already linked (OAuth is the
//     stronger proof and wins);
//   · re-link an account in discord_orphaned_accounts — somebody UNLINKED it,
//     on purpose or by leaving; importing it back would undo their choice;
//   · use ชั้นปี — it is not stored (src/js/study-year.js computes it), and the
//     nickname's copy is a year stale by construction.
// Every row it writes says link_source = 'nickname-import' (0195), and the web
// button upgrades it to 'oauth' the moment the person uses it.
//
// Runs HERE (needs Supabase, not the Discord token). The guild comes from a
// dump the VM wrote — the token never moves (skills/discord-role-sync.md):
//   ssh samo-vm … node discord-report.mjs --fetch /tmp/g.json ; scp it back
//   node tools/discord-nickname-link.mjs --guild g.json                # plan
//   node tools/discord-nickname-link.mjs --guild g.json --apply --link N [--confirm id,id]
// ============================================================
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NICK = /^(.+?)_#(\d)_(\d{3})-(\d)\s*$/;
const squash = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
const last4 = (s) => String(s ?? '').replace(/\D/g, '').slice(-4);

/**
 * Pure. members: [{id, display, bot}] · people: [{id, nickname, student_id}]
 * linkedPeople / linkedAccounts / orphaned: Sets of ids.
 */
export function plan({ members, people, linkedPeople, linkedAccounts, orphaned, confirm = [] }) {
  const byDigits = new Map();
  for (const p of people) {
    const k = last4(p.student_id);
    if (k.length === 4) (byDigits.get(k) || byDigits.set(k, []).get(k)).push(p);
  }
  const out = { link: [], near: [], none: [], unparsed: [], skipped: [] };
  const claimed = new Map();   // person id → discord ids that matched them
  for (const m of members) {
    if (m.bot) continue;
    const x = NICK.exec(String(m.display ?? '').trim());
    if (!x) { out.unparsed.push(m); continue; }
    const cands = byDigits.get(x[3] + x[4]) || [];
    const exact = cands.filter((p) => squash(p.nickname) === squash(x[1]));
    let person = null; let how = 'exact';
    if (exact.length === 1) person = exact[0];
    else if (exact.length === 0 && cands.length === 1) {
      if (confirm.includes(m.id)) { person = cands[0]; how = 'confirmed'; } else { out.near.push({ member: m, person: cands[0] }); continue; }
    } else { out.none.push({ member: m, candidates: cands.length }); continue; }

    if (linkedAccounts.has(m.id)) { out.skipped.push({ member: m, why: 'account already linked' }); continue; }
    if (orphaned.has(m.id)) { out.skipped.push({ member: m, why: 'account was UNLINKED — not re-linking' }); continue; }
    if (linkedPeople.has(person.id)) { out.skipped.push({ member: m, why: 'person already linked' }); continue; }
    out.link.push({ member: m, person, how });
    (claimed.get(person.id) || claimed.set(person.id, []).get(person.id)).push(m.id);
  }
  // Two Discord accounts matching ONE person: neither is linked — the unique
  // index would refuse the second anyway, and picking one is a guess.
  const twice = new Set([...claimed].filter(([, ids]) => ids.length > 1).map(([pid]) => pid));
  for (const l of out.link.filter((l) => twice.has(l.person.id))) {
    out.skipped.push({ member: l.member, why: 'two accounts match this person' });
  }
  out.link = out.link.filter((l) => !twice.has(l.person.id));
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const { loadEnv, resolveTarget, runSql } = await import('./env-lib.mjs');
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const guildFile = val('--guild');
  if (!guildFile) { console.error('✗ --guild <dump.json> is required (written by discord-report.mjs --fetch on the VM)'); process.exit(1); }
  const guild = JSON.parse(readFileSync(guildFile, 'utf8'));
  const confirm = (val('--confirm') || '').split(',').map((s) => s.trim()).filter(Boolean);

  const target = resolveTarget(loadEnv());
  const q = async (sql) => JSON.parse(await runSql(sql, target));
  const [people, links, orphans] = await Promise.all([
    q('select id, nickname, student_id, full_name from public.people;'),
    q('select person_id, discord_user_id from public.discord_links;'),
    q('select discord_user_id from public.discord_orphaned_accounts;'),
  ]);
  const r = plan({
    members: guild.members, people, confirm,
    linkedPeople: new Set(links.map((l) => l.person_id)),
    linkedAccounts: new Set(links.map((l) => l.discord_user_id)),
    orphaned: new Set(orphans.map((o) => o.discord_user_id)),
  });
  const unknownConfirm = confirm.filter((id) => !r.link.some((l) => l.member.id === id && l.how === 'confirmed'));
  if (unknownConfirm.length) {
    console.error(`✗ REFUSED — --confirm names ${unknownConfirm.length} id(s) that are not a near-match: ${unknownConfirm.join(', ')}`);
    process.exit(1);
  }

  console.log(`→ project: ${target.ref}   guild dump: ${guild.fetched_at}`);
  console.log(`\nLINK      ${r.link.length}   (${r.link.filter((l) => l.how === 'confirmed').length} confirmed by hand)`);
  console.log(`NEAR      ${r.near.length}   digits match ONE person, ชื่อเล่น differs — confirm by hand`);
  for (const n of r.near) console.log(`    ${n.member.id}  ${n.member.display}   ≈  ${n.person.full_name ?? '?'} (ชื่อเล่น ${n.person.nickname ?? '—'})`);
  console.log(`NO MATCH  ${r.none.length}`);
  for (const n of r.none) console.log(`    ${n.member.display}  (${n.candidates} people with those digits)`);
  console.log(`UNPARSED  ${r.unparsed.length}   nickname not in the ชื่อเล่น_#ปี_XXX-X shape — they use the button`);
  console.log(`SKIPPED   ${r.skipped.length}`);
  for (const s of r.skipped) console.log(`    ${s.member.display}: ${s.why}`);

  if (!args.includes('--apply')) {
    console.log('\nPLAN ONLY — nothing was written.');
    console.log(`  to write:  node tools/discord-nickname-link.mjs --guild ${guildFile} --apply --link ${r.link.length}${confirm.length ? ` --confirm ${confirm.join(',')}` : ''}`);
    return;
  }
  if (Number(val('--link')) !== r.link.length) {
    console.error(`\n✗ REFUSED — the plan changed since you read it: you passed --link ${val('--link')}, now ${r.link.length}.`);
    process.exit(1);
  }
  if (!r.link.length) { console.log('nothing to link.'); return; }

  // ONE statement: all or nothing. `on conflict do nothing` on BOTH unique keys
  // means a link made through the web between plan and apply is never
  // overwritten — and the RETURNING count below says so if it happens.
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const values = r.link.map((l) => `(${lit(l.person.id)}::uuid, ${lit(l.member.id)}, 'nickname-import')`).join(',\n  ');
  const rows = await q(`insert into public.discord_links (person_id, discord_user_id, link_source)
values
  ${values}
on conflict do nothing
returning person_id;`);
  console.log(`\n✓ linked ${rows.length} of ${r.link.length}.`);
  if (rows.length !== r.link.length) {
    console.log(`⚠️  ${r.link.length - rows.length} were linked by someone else between plan and apply — left as they were.`);
  }
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
