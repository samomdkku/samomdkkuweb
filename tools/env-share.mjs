#!/usr/bin/env node
// ============================================================
// env-share.mjs — `npm run env:share`. Produce the block to send a contributor.
//
//   npm run env:share            # what everyone needs (2 lines today)
//   npm run env:share --db       # + the database-work values, when asked for
//   npm run env:share --only SUPABASE_DEV_ANON_KEY    # just the one that rotated
//
// THE OTHER HALF OF THE TOIL, and the dangerous half. `npm run setup` removed
// the retyping on the RECEIVING side; this removes the hand-assembly on the
// SENDING side, which is where a mistake is expensive rather than annoying.
// Hand-assembling means opening a file that also contains SUPABASE_DB_URL and
// SAMO_VM_SUDO_PASSWORD and selecting the right lines out of it — a
// copy-paste-adjacent operation performed on production credentials, repeated
// every time somebody joins or a key rotates.
//
// ⛔ IT CANNOT EMIT A PRODUCTION NAME. The set it will print is derived from
// `.env.local.example`'s own declarations, so a name that is not offered to a
// contributor there cannot be shared from here, whatever flags are passed.
// `--only` is filtered through the same set.
//
// ⚠️ IT PRINTS REAL SECRETS, deliberately — that is its whole job. So it warns
// where they are going and refuses to run without a TTY unless forced, because
// the most likely accident is piping it somewhere that keeps a copy.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvLocal } from './migrations-lib.mjs';
import { manifest, isPlaceholder } from './env-check.mjs';

const ROOT = join(import.meta.dirname, '..');

/**
 * Which names may be shared, and which of those were asked for.
 *
 * Derived from the example, never from a list here — so adding a variable to
 * `.env.local.example` makes it shareable, and nothing else has to be edited.
 * That is the answer to "what if there are more keys later".
 */
export function selectNames(exampleText, { db = false, only = [] } = {}) {
  const { required, optional } = manifest(exampleText);
  const shareable = new Set([...required, ...optional]);
  if (only.length) {
    const refused = only.filter((n) => !shareable.has(n));
    return { names: only.filter((n) => shareable.has(n)), refused, shareable };
  }
  return { names: db ? [...required, ...optional] : required, refused: [], shareable };
}

function main() {
  const argv = process.argv.slice(2);
  const db = argv.includes('--db');
  const force = argv.includes('--force');
  const only = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only' && argv[i + 1]) only.push(...argv[i + 1].split(','));
  }

  const example = readFileSync(join(ROOT, '.env.local.example'), 'utf8');
  const { names, refused, shareable } = selectNames(example, { db, only });

  if (refused.length) {
    console.error(`\n⛔ Refusing to share: ${refused.join(', ')}\n`);
    console.error('  These are not values .env.local.example offers a contributor.');
    console.error('  If one of them reaches production, it must never be sent —');
    console.error('  and if it is genuinely a contributor value, add it to the');
    console.error('  example first, which is the only place that decides.\n');
    console.error(`  Shareable: ${[...shareable].join(', ')}\n`);
    process.exit(1);
  }

  // The most likely accident is `npm run env:share > somewhere-it-persists`.
  if (!process.stdout.isTTY && !force) {
    console.error('\n⛔ Not a terminal. This prints real secrets, and redirecting');
    console.error('  them into a file or a pipe is how they end up somewhere');
    console.error('  nobody meant. If you truly want that, pass --force.\n');
    process.exit(1);
  }

  const env = loadEnvLocal(join(ROOT, '.env.local'));
  const missing = names.filter((n) => !env[n] || isPlaceholder(n, env[n]));
  if (missing.length) {
    console.error(`\n✗ Your own .env.local has no value for: ${missing.join(', ')}\n`);
    console.error('  You cannot send what you do not have.\n');
    process.exit(1);
  }

  console.log('');
  console.log('  Send everything between the lines. They paste it whole into');
  console.log('  `npm run setup` — no editing, no formatting, greeting and all.');
  console.log('');
  console.log('  ─────────────────────────────────────────────');
  for (const n of names) console.log(`${n}=${env[n]}`);
  console.log('  ─────────────────────────────────────────────');
  console.log('');
  if (names.some((n) => manifest(example).optional.includes(n))) {
    console.log('  ⚠️  This block includes DATABASE-WORK values. They can delete');
    console.log('      the practice project and read every real student record.');
    console.log('      Send them only to someone who is actually doing migrations.');
    console.log('');
  }
  console.log('  ⛔ Not by LINE, Discord, Messenger, email or a shared doc — those');
  console.log('     keep the value for ever. Use a link that self-destructs, or');
  console.log('     the vault (skills/onboard-a-contributor.md has both roads).');
  console.log('');
  console.log('  ⚠️  samo-dev holds REAL student data. Say so when you send it.');
  console.log('');
}

if (import.meta.filename === process.argv[1]) main();
