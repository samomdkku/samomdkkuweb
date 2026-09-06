#!/usr/bin/env node
// ============================================================
// env-check.mjs — "is my .env.local right?", asked by a CONTRIBUTOR.
//
//   npm run env:check
//
// WHY THIS IS NOT `npm run dev:check`. It was, for about an hour, because
// docs/start/install.md told a new contributor to run that one. dev:check
// compares samo-dev's permission behaviour against PRODUCTION's — line 51 reads
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, which a contributor does not
// have and must never be sent. So the first thing a new contributor was told to
// run would have exited 1 with
//
//     ✗ PRODUCTION: URL or anon key missing from .env.local
//
// having proved nothing about the four keys they DID paste. A verification step
// that fails on a correct setup is worse than no verification step: it blames
// the reader for the guide's mistake, at the exact moment they have no way to
// tell the difference.
//
// ⛔ DO NOT "SIMPLIFY" THESE TWO INTO ONE. dev:check is a parity guard whose
// whole value is that it needs both sides; teaching it to skip the production
// half when credentials are absent would make it pass in the one case it exists
// to catch (docs/mistakes/tooling-proofs.md — a guard that fails GREEN).
//
// This one asks only what a contributor can answer:
//   1. does the file exist, in the right place
//   2. are the two names you need to RUN the site present, and not still the
//      placeholders (the two database-work ones are reported, never required —
//      see REQUIRED below for why that split matters)
//   3. does the dev database actually answer
// and it says what to do about each failure rather than only that it failed.
// ============================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvLocal } from './migrations-lib.mjs';

const ROOT = join(import.meta.dirname, '..');
const ENV_PATH = join(ROOT, '.env.local');

/**
 * What everybody needs to RUN the site. Their one home is .env.local.example.
 *
 * ⛔ IT WAS FOUR UNTIL 2026-09-06, and that was the real security problem here.
 * These two are the pair the built website already publishes — an address and a
 * visitor key that RLS gates. The other two are not more of the same:
 * SUPABASE_DEV_ACCESS_TOKEN can delete the samo-dev project, and
 * SUPABASE_DEV_DB_URL is a direct database login that ignores every permission
 * rule, over an UNMASKED copy of real student records. Requiring all four meant
 * every volunteer changing a colour was handed both.
 *
 * The split is not cosmetic: `inspect()` FAILS on a missing one of these and
 * only NOTES a missing one of OPTIONAL, so a contributor who has been sent two
 * lines gets a green check instead of being told their setup is broken.
 */
export const REQUIRED = [
  'SUPABASE_DEV_URL',
  'SUPABASE_DEV_ANON_KEY',
];

/** Needed only for database work — migrations, proofs, dev:check, dev:google. */
export const OPTIONAL = [
  'SUPABASE_DEV_ACCESS_TOKEN',
  'SUPABASE_DEV_DB_URL',
];

/**
 * Is this value still the example's placeholder?
 *
 * Checked because pasting three of four lines is the common slip, and a
 * leftover placeholder is INDISTINGUISHABLE from a real value to every other
 * check — it is present, it is non-empty, and it is wrong.
 */
export function isPlaceholder(name, value) {
  if (!value) return false;
  const v = value.trim();
  return /^paste-/.test(v)
    || /^sbp_paste-/.test(v)
    || v.includes('your-dev-project-ref')
    || v === 'postgresql://user:password@host:5432/postgres';
}

/** Problems with the VALUES, in the order a reader should fix them. */
export function inspect(env) {
  const problems = [];
  for (const name of REQUIRED) {
    const v = env[name];
    if (!v || !v.trim()) {
      problems.push({ name, why: 'missing', fix: `add a ${name}= line` });
    } else if (isPlaceholder(name, v)) {
      problems.push({
        name,
        why: 'still the placeholder from .env.local.example',
        fix: 'replace it with the value a maintainer sent you',
      });
    } else if (/^["'].*["']$/.test(v.trim())) {
      // Quotes are read as part of the value, so this fails later and elsewhere.
      problems.push({
        name, why: 'wrapped in quotation marks',
        fix: 'remove the quotes — the value is everything after the =',
      });
    }
  }
  const url = env.SUPABASE_DEV_URL;
  if (url && url.trim() && !isPlaceholder('SUPABASE_DEV_URL', url)
      && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url.trim())) {
    problems.push({
      name: 'SUPABASE_DEV_URL',
      why: 'does not look like a Supabase URL',
      fix: 'it should read https://<something>.supabase.co and nothing more',
    });
  }
  return problems;
}

/** One anonymous read the dev database must answer 200 to. */
async function reachable(url, key) {
  const base = url.trim().replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/announcements?select=id&limit=1`, {
    headers: { apikey: key.trim(), Authorization: `Bearer ${key.trim()}` },
  });
  return res.status;
}

async function main() {
  console.log('');
  if (!existsSync(ENV_PATH)) {
    console.error('✗ There is no .env.local in the project folder.\n');
    console.error('  Create it from the example, then paste in the values a');
    console.error('  maintainer sent you:\n');
    console.error('      cp .env.local.example .env.local\n');
    console.error('  If that command says "No such file", you are in the wrong');
    console.error('  folder — run `pwd` and cd into samomdkkuweb.\n');
    process.exit(1);
  }

  const env = { ...loadEnvLocal(), ...process.env };
  const problems = inspect(env);
  if (problems.length) {
    console.error(`✗ .env.local exists, but ${problems.length} value(s) need fixing:\n`);
    for (const p of problems) console.error(`  ${p.name}\n      ${p.why} — ${p.fix}`);
    console.error('\n  One NAME=value per line. No spaces around the =, no quotes.\n');
    process.exit(1);
  }
  console.log('✓ the two values you need to run the site are present and filled in');

  // Reported, never required. A contributor who has correctly been sent only
  // two lines must not be told their setup is incomplete — that is the
  // "fails on a CORRECT setup" trap this whole script was written to avoid.
  const extras = OPTIONAL.filter((n) => env[n] && env[n].trim() && !isPlaceholder(n, env[n]));
  if (extras.length === OPTIONAL.length) {
    console.log('✓ the database-work values are set too (migrations, proofs)');
  } else if (extras.length === 0) {
    console.log('· no database-work values — normal, and all you need for');
    console.log('  pages, styling, text and behaviour. Ask only if you take on');
    console.log('  a migration.');
  } else {
    console.log(`· ${extras.length} of ${OPTIONAL.length} database-work values set —`);
    console.log('  migrations and proofs will fail until the other is added.');
  }

  let status;
  try {
    status = await reachable(env.SUPABASE_DEV_URL, env.SUPABASE_DEV_ANON_KEY);
  } catch (err) {
    console.error(`\n✗ Could not reach the development database: ${err.message}`);
    console.error('  Check your internet connection, then check SUPABASE_DEV_URL.\n');
    process.exit(1);
  }
  if (status === 200) {
    console.log('✓ the development database answered');
    console.log('\nYou are set up. Run `npm run dev` and open the address it prints.\n');
    return;
  }
  if (status === 401) {
    console.error('\n✗ The database refused the key (401).');
    console.error('  SUPABASE_DEV_ANON_KEY is wrong or was truncated when pasted —');
    console.error('  it is long, and it must be on ONE line.\n');
    process.exit(1);
  }
  console.error(`\n✗ The database answered ${status}, which was not expected.`);
  console.error('  Send that number to a maintainer.\n');
  process.exit(1);
}

if (import.meta.filename === process.argv[1]) main();
