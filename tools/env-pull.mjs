#!/usr/bin/env node
// ============================================================
// env-pull.mjs — `npm run env:pull`. Fetch your own credentials from the vault.
//
// THE PROBLEM THIS EXISTS FOR, in the owner's words on 2026-09-06:
//
//   "but then i have to be access to my computer to can do it, it isn't
//    convenient for me"
//   "and i would have to send it many times for each person isn't it"
//
// Both true, and both are the same problem: the owner was the delivery
// mechanism. `npm run env:share` still assumes a laptop, the repo, and a person
// awake. This removes the owner from the loop entirely — the values live in the
// vault once, and each person fetches their own.
//
// ⛔ WHAT I GOT WRONG FIRST, corrected by measurement. I told the owner the
// Bitwarden CLI could not work here because our vault is at a SUBPATH
// (`/vault/`, since KKU issues no subdomain) and `bw` "expects a bare root" —
// that claim came from a search result, not from a test. It is false. Measured
// 2026-09-06:
//
//   $ bw config server https://samo.md.kku.ac.th/vault
//     Saved setting `config`.            → stores base, derives /api + /identity
//   $ bw login <nonexistent user>
//     Username or password is incorrect. → it REACHED Vaultwarden's identity
//                                          endpoint; a wrong URL gives a
//                                          connection error, not an auth one
//   $ bw status
//     {"serverUrl":"https://samo.md.kku.ac.th/vault", ... }
//
// And the vault publishes the same shape itself at `/vault/api/config`:
//   "api":".../vault/api", "identity":".../vault/identity"
// which is exactly `<base>/api` and `<base>/identity`. Nothing special needed.
//
// ⚠️ WHAT IS STILL UNVERIFIED. Everything up to authentication is measured; an
// actual authenticated `bw get item` has NOT been run, because that needs a
// vault account and the `Dev` collection, neither of which existed when this
// was written (docs/state/HANDOFF.md §7). So this fails LOUDLY and says which
// step failed, rather than pretending. The first person to run it end to end
// should update HANDOFF.
// ============================================================
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REQUIRED, OPTIONAL } from './env-check.mjs';
import { isPlaceholder } from './env-manifest.mjs';
import { parsePaste, mergeEnvFile, productionNames } from './setup-env.mjs';
import { VAULT_URL, VAULT_ITEM } from './vault-config.mjs';

const ROOT = join(import.meta.dirname, '..');
const ENV_PATH = join(ROOT, '.env.local');

/** Pinned on purpose — an unpinned `npx` is a different program each week. */
const BW = ['--yes', '@bitwarden/cli@2026.8.0'];

/**
 * ⛔ NEVER TOUCH THE USER'S GLOBAL BITWARDEN CONFIG.
 *
 * `bw config server` writes to `~/Library/Application Support/Bitwarden CLI/`
 * (or the OS equivalent) by default — so the first version of this tool
 * SILENTLY REPOINTED a personal Bitwarden CLI at the SAMO vault. Measured
 * 2026-09-06 by running it and finding the file it had just created. Anyone who
 * uses `bw` for their own passwords would have found it talking to us, with
 * nothing to say why.
 *
 * `BITWARDENCLI_APPDATA_DIR` keeps every byte inside the project, gitignored.
 * A contributor's own vault setup is none of this project's business.
 */
const BW_DIR = join(ROOT, '.bw');

/**
 * The `bw` subcommands that ASK THE HUMAN A QUESTION.
 *
 * ⛔ MEASURED 2026-09-07, after `npm run env:pull` appeared to hang forever on
 * its very first real run: **the Bitwarden CLI writes its prompts to STDERR**,
 * not stdout. This function used to pipe BOTH streams, so `? Email address:`
 * went into a buffer nobody read while stdin sat inherited and waiting. The
 * terminal showed "Signing in." and then nothing, for ever, with the program
 * healthy and the cursor blocked on an invisible question.
 *
 *   $ bw login --raw </dev/null 1>out 2>err
 *     out: (empty)          ← --raw would put the session key here
 *     err: ? Email address:  ← the prompt
 *
 * So the stream that carries a QUESTION must reach the person who has to
 * answer it. Only stdout is captured, because that is where `--raw` puts the
 * session key. `stdioFor` is exported so a test can assert this property
 * rather than a comment asking the next editor to remember it.
 */
const PROMPTING = new Set(['login', 'unlock']);

export function stdioFor(args, { input } = {}) {
  if (input !== undefined) return ['pipe', 'pipe', 'pipe'];
  // stderr: 'inherit' for anything that prompts — otherwise 'pipe', because a
  // non-prompting command's stderr is the diagnostic that die() quotes.
  return ['inherit', 'pipe', PROMPTING.has(args[0]) ? 'inherit' : 'pipe'];
}

function bw(args, { session, input } = {}) {
  mkdirSync(BW_DIR, { recursive: true });
  return execFileSync('npx', [...BW, ...args], {
    encoding: 'utf8',
    stdio: stdioFor(args, { input }),
    input,
    env: {
      ...process.env,
      BITWARDENCLI_APPDATA_DIR: BW_DIR,
      ...(session ? { BW_SESSION: session } : {}),
    },
  }).trim();
}

function die(what, ...advice) {
  console.error(`\n✗ ${what}\n`);
  for (const line of advice) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
}

/**
 * Pull the env block out of a vault item's JSON.
 *
 * The convention, and it is deliberately the DUMBEST one that works: a single
 * item whose **notes** field holds exactly what `npm run env:share` prints. No
 * custom fields, no per-value items — because the person maintaining it edits
 * it in a phone app, and anything cleverer is something to get wrong at 11pm.
 */
export function blockFromItem(itemJson) {
  let item;
  try {
    item = typeof itemJson === 'string' ? JSON.parse(itemJson) : itemJson;
  } catch {
    return { error: 'the vault returned something that was not an item' };
  }
  const notes = item?.notes;
  if (!notes || !String(notes).trim()) {
    return { error: `the item "${item?.name ?? '?'}" has an empty Notes field` };
  }
  return { text: String(notes) };
}

async function main() {
  const example = readFileSync(join(ROOT, '.env.local.example'), 'utf8');

  console.log('');
  console.log(`  Fetching your credentials from ${VAULT_URL}`);
  console.log('');
  console.log('  (First run on this machine downloads the Bitwarden CLI,');
  console.log('   about 17 MB. Give it a moment.)');
  console.log('');

  try {
    bw(['config', 'server', VAULT_URL]);
  } catch (err) {
    die('could not configure the Bitwarden CLI.',
      'This needs Node and network access. The error was:',
      String(err.stderr || err.message).split('\n')[0]);
  }

  let status;
  try {
    status = JSON.parse(bw(['status']));
  } catch {
    status = { status: 'unauthenticated' };
  }

  let session;
  try {
    if (status.status === 'unauthenticated') {
      console.log('  Signing in. Use your SAMO vault email and master password.');
      console.log('  (Nothing is stored in this project — the session ends when');
      console.log('   this command does.)');
      console.log('');
      session = bw(['login', '--raw']);
    } else {
      console.log('  Unlocking your vault.');
      console.log('');
      session = bw(['unlock', '--raw']);
    }
  } catch (err) {
    // Its stderr went straight to the terminal (see stdioFor), so the CLI has
    // already said what was wrong in its own words — do not swallow that under
    // a paraphrase of `Command failed: npx …`.
    const own = String(err.stderr || '').split('\n').filter(Boolean).pop();
    die(own ? `could not sign in to the vault: ${own}` : 'could not sign in to the vault (its own message is above).',
      'If you do not have an account yet, ask for an invitation — this',
      'command cannot create one.',
      '',
      'If you DO have one and it still refuses, check you are using the',
      `SAMO vault at ${VAULT_URL} and not bitwarden.com.`);
  }

  // ⚠️ `bw login` EXITS 0 WITH NO SESSION when its prompt reaches end-of-input
  // — measured, `</dev/null` → exit 0, empty stdout. Without this the run
  // carries on with BW_SESSION='' and fails four steps later saying the item
  // cannot be read, which is a lie about which step went wrong.
  if (!session) {
    die('sign-in did not complete — no session came back.',
      'If you were not asked anything, this command had no terminal to ask',
      'in. Run it directly in a terminal, not through a pipe or a wrapper.');
  }

  let raw;
  try {
    bw(['sync'], { session });
    raw = bw(['get', 'item', VAULT_ITEM], { session });
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message).split('\n').filter(Boolean).pop();
    try { bw(['lock'], { session }); } catch { /* best effort */ }
    die(`could not read "${VAULT_ITEM}" from the vault: ${msg}`,
      'Either it does not exist yet, or it has not been shared with you.',
      'Ask a maintainer to share the Dev collection with your account.');
  }

  const { text, error } = blockFromItem(raw);
  try { bw(['lock'], { session }); } catch { /* best effort */ }
  if (error) {
    die(error,
      'A maintainer fills that Notes field with the output of',
      '`npm run env:share`, pasted whole.');
  }

  const parsed = parsePaste(text);

  // Same refusal as `npm run setup`: if a production name is in there, somebody
  // put the wrong thing in the vault and the answer is a conversation.
  const leaked = productionNames(example).filter((n) => n in parsed);
  if (leaked.length) {
    die(`the vault item contains values that must never be shared: ${leaked.join(', ')}`,
      'Nothing has been written. Tell a maintainer TODAY — that item is',
      'readable by everyone the collection is shared with.');
  }

  const known = new Set([...REQUIRED, ...OPTIONAL]);
  const write = {};
  for (const [n, v] of Object.entries(parsed)) {
    if (known.has(n) && v && !isPlaceholder(n, v)) write[n] = v;
  }
  if (!Object.keys(write).length) {
    die('the vault item had no usable values in it.',
      'Its Notes field should hold lines like SUPABASE_DEV_URL=…');
  }

  const missing = REQUIRED.filter((n) => !write[n]);
  if (missing.length) {
    die(`the vault item is missing: ${missing.join(', ')}`,
      'Ask a maintainer to refresh it with `npm run env:share`.');
  }

  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  if (existing) copyFileSync(ENV_PATH, `${ENV_PATH}.backup`);
  const { text: merged } = mergeEnvFile(existing, write);
  writeFileSync(ENV_PATH, merged);

  console.log(`✓ .env.local updated from the vault — ${Object.keys(write).length} value(s):\n`);
  for (const n of Object.keys(write)) console.log(`      ${n}`);
  if (existing) console.log('\n  Your previous file is saved as .env.local.backup');
  console.log('');
  console.log('  Run it again whenever a key changes — it is always current.');
  console.log('');
  console.log('  Now check it end to end:\n');
  console.log('      npm run env:check\n');
}

if (import.meta.filename === process.argv[1]) main();
