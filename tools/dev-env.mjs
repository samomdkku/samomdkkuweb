// ============================================================
// dev-env.mjs — point `npm run dev` at the PRACTICE database.
//
// ⛔ THE BUG THIS EXISTS TO FIX, because it was invisible for weeks.
//
// The app reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (src/js/db.js).
// The contributor guide hands people `SUPABASE_DEV_URL` / `SUPABASE_DEV_ANON_KEY`
// (.env.local.example). NOTHING mapped one to the other. Measured 2026-09-06 by
// building a contributor's .env.local exactly as docs/start/install.md produces
// it and asking Vite's own loader what it exposed:
//
//     loadEnv('development', dir, 'VITE_')  ->  {}
//
// So a new contributor did every step correctly, `npm run env:check` printed
// "✓ You are set up", and then:
//
//   - the PORTAL loaded with no database at all — identical to having pasted
//     nothing, which is the state §4e of the guide describes as the FAILURE;
//   - PASSPORT loaded against **production**, because passport/js/app.js falls
//     back to a hardcoded live URL + anon key when the variable is unset. A
//     volunteer following the guide was talking to real student records.
//
// Nobody noticed because a maintainer's own .env.local carries VITE_* pointing
// at PRODUCTION, so `npm run dev` worked on the one machine it was tested on —
// and worked by talking to the live site. Both halves of that are wrong.
//
// ⚠️ THE GUARD THAT SHOULD HAVE CAUGHT IT DIDN'T. env-example.test.js asserted
// that the example declares exactly the four SUPABASE_DEV_* names and that the
// docs name the same four — a list compared against a list. It never asked the
// question that mattered: *can the app read what the example declares?* That is
// `.claude/rules/mistakes.md` class 7, "a guard that cannot SEE the hazard".
// dev-env.test.js now asserts the PROPERTY instead.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvLocal } from './migrations-lib.mjs';
import { manifest, isPlaceholder } from './env-manifest.mjs';

/** Set only when the caller deliberately wants the live database in dev. */
export const PROD_OVERRIDE = 'SAMO_DEV_USE_PROD';

/**
 * Decide what the dev server should talk to. Pure — takes the file contents and
 * the process environment, returns a decision. Exported so the test can ask it
 * about inputs that are awkward to create on disk.
 *
 * ⛔ THE ORDER IS THE SAFETY PROPERTY. samo-dev WINS over a VITE_* already in
 * `.env.local`, and that is deliberate rather than an oversight: on a
 * maintainer's machine those VITE_* values are PRODUCTION, so preferring them
 * is what made `npm run dev` edit real student records. If you ever need the
 * live database locally, say so out loud:
 *
 *     SAMO_DEV_USE_PROD=1 npm run dev
 */
export function decideDevDatabase(fileEnv = {}, procEnv = {}) {
  if (procEnv[PROD_OVERRIDE]) {
    return { use: 'production', reason: `${PROD_OVERRIDE} is set` };
  }
  const url = (fileEnv.SUPABASE_DEV_URL || '').trim();
  const key = (fileEnv.SUPABASE_DEV_ANON_KEY || '').trim();
  if (!url || !key) {
    return { use: 'unset', reason: 'no SUPABASE_DEV_URL / SUPABASE_DEV_ANON_KEY in .env.local' };
  }
  // A leftover placeholder is present, non-empty and wrong — indistinguishable
  // from a real value to every other check. env-check.mjs owns the full list;
  // this only needs to avoid pointing the dev server at a made-up host.
  if (url.includes('your-dev-project-ref') || key.startsWith('paste-')) {
    return { use: 'unset', reason: '.env.local still holds the example placeholders' };
  }
  return { use: 'dev', url, key, reason: 'SUPABASE_DEV_* found in .env.local' };
}

/**
 * Apply that decision to `process.env`, for Vite to pick up.
 *
 * ⛔ CALL THIS ONLY ON `command === 'serve'`. A production build must take its
 * values from the VM's own `.env.local` and nothing else; if this ever ran
 * during `vite build`, a deploy would ship a bundle wired to samo-dev while
 * every other signal said production. `dev-env.test.js` asserts both vite
 * configs gate on the command.
 *
 * Returns the decision so the caller can PRINT which database it chose. Saying
 * it out loud is half the fix: the failure being prevented is somebody making
 * test edits believing they are on the practice copy.
 */
export function applyDevDatabaseEnv(procEnv = process.env, path = '.env.local') {
  const decision = decideDevDatabase(loadEnvLocal(path), procEnv);
  if (decision.use !== 'dev') return decision;
  procEnv.VITE_SUPABASE_URL = decision.url;
  procEnv.VITE_SUPABASE_ANON_KEY = decision.key;
  // Reuses the existing ribbon (src/js/env-ribbon.js) rather than inventing a
  // second way to say "not production". Anything other than 'production' paints
  // it, so the page itself now says which database it is on.
  procEnv.VITE_ENV_NAME ||= 'development';
  return decision;
}

/** One line for the terminal, so the choice is never a guess. */
export function describeDevDatabase(decision) {
  const ref = (decision.url || '').match(/\/\/([^.]+)\./)?.[1];
  if (decision.use === 'dev') return `  database: samo-dev (${ref}) — safe to click anything\n`;
  if (decision.use === 'production') {
    return '  ⚠️  database: PRODUCTION — every edit is live. '
      + `Unset ${PROD_OVERRIDE} to go back to the practice copy.\n`;
  }
  return '  ⚠️  database: NONE configured — lists will be empty. '
    + 'Run `npm run env:check` to find out why.\n';
}

/**
 * HAS `.env.local` FALLEN BEHIND `.env.local.example`?
 *
 * ⛔ THE QUESTION THIS ANSWERS, asked by the owner on 2026-09-06: *"incase in
 * the future there's more key, or key is changed, it would be tiresome to
 * manually copy paste each key"*. The tiresome part is not the typing — it is
 * that NOTHING TOLD ANYONE. A variable added to the project reached a
 * contributor's machine only when something broke in a way that did not mention
 * it, weeks later, and then they had to work out which of their values was
 * stale by reading a diff of a file they had never opened.
 *
 * The example is the contract, so the comparison is mechanical: anything it
 * declares as an active line and `.env.local` lacks is a value this person has
 * not been sent yet. They find out at the only moment it is cheap to fix — the
 * moment they start the dev server — and are told exactly what to ask for.
 *
 * Returns names, never values. Pure, so the test can hand it any pair.
 */
export function envDrift(exampleText, fileEnv = {}) {
  const { required, optional } = manifest(exampleText);
  const missing = required.filter((n) => !fileEnv[n] || !String(fileEnv[n]).trim());
  const stale = required.filter((n) => fileEnv[n] && isPlaceholder(n, fileEnv[n]));
  const extraOptional = optional.filter((n) => fileEnv[n] && String(fileEnv[n]).trim());
  return { missing, stale, extraOptional };
}

/**
 * The drift, as a line for the terminal — or '' when there is nothing to say.
 *
 * ⚠️ SILENCE ON THE HEALTHY CASE IS THE POINT. A warning that fires when
 * nothing is wrong is worse than no warning (`.claude/rules/mistakes.md`
 * class 6), and a contributor with a correct two-value setup must never be
 * nagged about the two they are right not to have.
 */
export function describeDrift(drift) {
  const lines = [];
  if (drift.missing.length) {
    lines.push(`  ⚠️  .env.local is missing ${drift.missing.length} value(s) this`);
    lines.push('      project now needs — you have not been sent them yet:');
    for (const n of drift.missing) lines.push(`        ${n}`);
    // The vault is the route that does not need a person: `env:pull` already
    // has whatever was added. Naming `setup` second keeps the answer correct
    // for someone who has no vault account yet.
    lines.push('      Run: npm run env:pull   (or ask a maintainer, then: npm run setup)');
  }
  if (drift.stale.length) {
    lines.push(`  ⚠️  still the example placeholder: ${drift.stale.join(', ')}`);
    lines.push('      Run `npm run env:pull`, or `npm run setup` and paste what you were sent.');
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Read the example and the local file, and report the gap. */
export function driftNow(root, path = '.env.local') {
  try {
    const example = readFileSync(join(root, '.env.local.example'), 'utf8');
    return describeDrift(envDrift(example, loadEnvLocal(path)));
  } catch {
    return '';   // No example to compare against is not a contributor's problem.
  }
}
