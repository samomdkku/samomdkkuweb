#!/usr/bin/env node
// ============================================================
// setup-env.mjs — `npm run setup`. Paste what you were sent; it writes the file.
//
//   npm run setup
//
// WHY THIS EXISTS. The guide used to say: copy `.env.local.example` to
// `.env.local`, open it in an editor, and replace each placeholder by hand. The
// owner's verdict on 2026-09-06 — *"input each key manually is bug prone"* — is
// correct, and the guide's own troubleshooting section proved it by listing the
// three ways it goes wrong: the file lands in the wrong folder, a pasted value
// gets wrapped onto two lines, or one placeholder is left behind because three
// of four lines were pasted. Every one of those is the transcription step, and
// the transcription step does not have to exist.
//
// So: the contributor pastes the block a maintainer sent them, exactly as it
// arrived, and this writes a correct file. It accepts every shape a value
// realistically arrives in — `export NAME=v`, quoted values, spaces around the
// `=`, a markdown code fence around the block, CRLF from Windows, and a long
// value wrapped across two lines by a chat client.
//
// ⛔ IT MERGES, IT NEVER CLOBBERS. A maintainer's `.env.local` holds production
// credentials and the VM sudo password. Overwriting that file to fix a
// contributor's onboarding would be a catastrophic trade, so every line this
// script is not setting is preserved byte for byte, and an existing value is
// only replaced after the file has been backed up next to itself.
//
// ⛔ IT NEVER PRINTS A VALUE. Names only — a terminal transcript is one of the
// places these are not supposed to end up.
// ============================================================
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { REQUIRED, OPTIONAL, isPlaceholder } from './env-check.mjs';

const ROOT = join(import.meta.dirname, '..');
const ENV_PATH = join(ROOT, '.env.local');

/**
 * Names that must never arrive in a contributor's paste. If one does, somebody
 * has sent the wrong block and the right response is to say so loudly — not to
 * quietly write it to disk. Their one home is `.env.local.example`'s trailing
 * comment; read from there so this list cannot drift from it.
 */
export function productionNames(exampleText) {
  const tail = exampleText.split('Maintainers only').pop() || '';
  return [...tail.matchAll(/\b([A-Z][A-Z0-9_]{4,})\b/g)]
    .map((m) => m[1])
    .filter((n) => !n.startsWith('SUPABASE_DEV_') && !n.startsWith('GOOGLE_DEV_'));
}

/**
 * Turn a pasted blob into { NAME: value }.
 *
 * Deliberately forgiving. Every tolerance below is a real way a value arrives:
 * a one-time-secret page adds a code fence, a shell-flavoured note prefixes
 * `export`, someone quotes a value that contains a `/`, Windows adds CR, and a
 * chat client wraps a 200-character key onto a second line — the last of which
 * the guide currently asks a person to notice and fix by hand.
 */
/**
 * Characters a wrapped credential can be made of — base64url, URLs, postgres
 * connection strings. Deliberately does NOT include box drawing, Thai, emoji or
 * spaces, all of which appear in the prose around a pasted block.
 */
const CONTINUATION = /^[A-Za-z0-9+/=._~:@%?&#!$'()*,;[\]-]+$/;

/**
 * ...AND it must contain something a credential is actually made of. `*` and
 * `-` are legal inside a real password, so they cannot be banned from the
 * charset — but a line of PURE punctuation (`***`, `─────`, `---`, `===`) is
 * never the second half of a key. This one rule covers every decoration a
 * person's message might carry, including Thai and emoji, which contain no
 * ASCII alphanumerics either.
 */
const HAS_SUBSTANCE = /[A-Za-z0-9]/;

export function parsePaste(text) {
  const out = {};
  let last = null;
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || /^```/.test(line)) continue;
    line = line.replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    const name = eq === -1 ? null : line.slice(0, eq).trim();
    if (eq === -1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      // No `NAME=` here. If the previous line opened one, this MAY be the rest
      // of a value a chat client wrapped.
      //
      // ⛔ THE CHARSET TEST CAME FROM AN ACTUAL BUG, not from caution. The first version
      // continued on any line without whitespace, so the `─────────────` rule
      // that `npm run env:share` prints around its block got glued onto the end
      // of the anon key — and pasting that whole block is the single most
      // likely thing a person does, because it is what they were shown. The
      // result would be a key that is wrong by thirteen invisible characters.
      // Continue only on characters a token can actually contain.
      if (last && CONTINUATION.test(line) && HAS_SUBSTANCE.test(line)) out[last] += line;
      continue;
    }
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1)
      || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    out[name] = v;
    last = name;
  }
  return out;
}

/**
 * Rewrite `.env.local` so that `values` are set, keeping every other line.
 *
 * Existing lines are edited in place rather than appended, so a name is never
 * present twice — a duplicate would be read differently by `loadEnvLocal`
 * (last wins) and by a human skimming (first wins), which is its own bug.
 */
export function mergeEnvFile(existing, values) {
  const lines = existing ? existing.split('\n') : [];
  const remaining = { ...values };
  const out = lines.map((line) => {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=)/.exec(line);
    if (!m || !(m[2] in remaining)) return line;
    const name = m[2];
    const v = remaining[name];
    delete remaining[name];
    return `${name}=${v}`;
  });
  const added = Object.keys(remaining);
  if (added.length) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('# Added by `npm run setup`.');
    for (const name of added) out.push(`${name}=${remaining[name]}`);
    out.push('');
  }
  return { text: out.join('\n').replace(/\n{3,}$/, '\n'), added };
}

/**
 * Does this line look like the start of a `NAME=value`? The paste ends at the
 * first blank line AFTER one of these.
 *
 * ⛔ THE FIRST VERSION ENDED AT THE FIRST BLANK LINE AFTER ANY NON-EMPTY LINE,
 * and the very first thing I tested it with broke it: people send a covering
 * note. "hey, here you go" + blank line closed the paste before a single
 * credential arrived, and the script then complained that nothing was pasted —
 * blaming the reader for its own bug, which is the failure this whole area of
 * the codebase exists to avoid (see tools/env-check.mjs's header). Waiting for
 * an actual assignment costs nothing and handles the note, the greeting and the
 * code fence alike.
 */
export function opensAssignment(line) {
  const t = String(line).trim().replace(/^export\s+/, '');
  const eq = t.indexOf('=');
  return eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.slice(0, eq).trim());
}

/** Read a pasted block from the terminal, ending at a blank line or EOF. */
function readPaste() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = [];
    let sawAssignment = false;
    rl.on('line', (line) => {
      if (line.trim() === '' && sawAssignment) return rl.close();
      if (opensAssignment(line)) sawAssignment = true;
      lines.push(line);
    });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}

async function main() {
  const example = readFileSync(join(ROOT, '.env.local.example'), 'utf8');

  console.log('');
  console.log('  Setting up .env.local');
  console.log('  ─────────────────────');
  console.log('');
  console.log('  Paste the lines a maintainer sent you — the whole thing, exactly');
  console.log('  as it arrived. Extra lines, quotes and stray text are fine.');
  console.log('');
  console.log('  Then press Enter on an empty line.');
  console.log('');

  const parsed = parsePaste(await readPaste());
  const names = Object.keys(parsed);
  console.log('');

  if (!names.length) {
    console.error('✗ Nothing that looked like NAME=value was pasted.\n');
    console.error('  Expected at least these two lines:\n');
    for (const n of REQUIRED) console.error(`      ${n}=...`);
    console.error('\n  Get them from the vault with `npm run env:pull`, or ask a');
    console.error('  maintainer for "the two SUPABASE_DEV_* lines".\n');
    process.exit(1);
  }

  // ⛔ Loudest possible failure. A contributor holding one of these can write
  // to real student records; the fix is a conversation, not a config edit.
  const leaked = productionNames(example).filter((n) => n in parsed);
  if (leaked.length) {
    console.error('⛔ STOP. You were sent something you should not have been sent:\n');
    for (const n of leaked) console.error(`      ${n}`);
    console.error('\n  These reach the LIVE site, not the practice copy. Nothing has');
    console.error('  been written. Tell whoever sent them, today — replacing one');
    console.error('  takes about two minutes and saying nothing is the expensive');
    console.error('  option. Then ask for the two SUPABASE_DEV_* lines instead.\n');
    process.exit(1);
  }

  const missing = REQUIRED.filter((n) => !parsed[n] || isPlaceholder(n, parsed[n]));
  if (missing.length) {
    console.error(`✗ ${missing.length} of the values needed to run the site are missing:\n`);
    for (const n of missing) {
      console.error(`      ${n}  ${parsed[n] ? '(still the example placeholder)' : '(not pasted)'}`);
    }
    console.error('\n  Nothing has been written. Paste the whole block and try again.\n');
    process.exit(1);
  }

  // Derived from the example via REQUIRED/OPTIONAL, so a variable added there
  // is accepted here with no second edit — the whole point of the manifest.
  const known = new Set([...REQUIRED, ...OPTIONAL]);
  const write = {};
  for (const n of names) if (known.has(n)) write[n] = parsed[n];
  const ignored = names.filter((n) => !known.has(n));

  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  if (existing) {
    // Never lose a file that may hold production credentials.
    copyFileSync(ENV_PATH, `${ENV_PATH}.backup`);
  }
  const { text, added } = mergeEnvFile(existing, write);
  writeFileSync(ENV_PATH, text);

  console.log(`✓ .env.local written — ${Object.keys(write).length} value(s) set:\n`);
  for (const n of Object.keys(write)) {
    console.log(`      ${n}${added.includes(n) ? '' : '  (replaced what was there)'}`);
  }
  if (existing) console.log('\n  Your previous file is saved as .env.local.backup');
  if (ignored.length) {
    console.log(`\n  Ignored ${ignored.length} name(s) this project does not use: ${ignored.join(', ')}`);
  }
  const hasDbWork = OPTIONAL.every((n) => write[n]);
  console.log('');
  console.log(hasDbWork
    ? '  Database-work values included — you can run migrations and proofs.'
    : '  No database-work values, which is normal. They are only needed for\n'
      + '  migrations; everything else works without them.');
  console.log('');
  console.log('  Now check it end to end:\n');
  console.log('      npm run env:check\n');
}

if (import.meta.filename === process.argv[1]) main();
