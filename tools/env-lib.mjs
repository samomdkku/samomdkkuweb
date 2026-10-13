#!/usr/bin/env node
// ============================================================
// env-lib.mjs — ONE answer to "what credentials do I have, and which Supabase
// project am I about to touch".
//
// WHY THIS EXISTS. 39 tools in this directory each hand-rolled the same
// `.env.local` parse, and they did not agree. `db-query.mjs`'s own header
// already records what that cost: it read `.env.local` ONLY, so the documented
// way to target samo-dev —
//
//     VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/db-query.mjs q.sql
//
// silently queried PRODUCTION, and a migration verified on 2026-08-28 was
// reported NOT APPLIED because the check read a different database than the
// write. That file was fixed. Its SIBLINGS were not, and the drift is still
// live today: measured 2026-08-29, `VITE_SUPABASE_URL=$SUPABASE_DEV_URL
// npm run proofs` runs the 17 `.sql` proofs against samo-dev and
// `proj0092-seat-parity.mjs` + `grant0093-reads.mjs` against PRODUCTION, and
// prints one green summary over the mixture.
//
// That is class 6 (two implementations of one rule drift) sitting under class 7
// (verify from the authority) — and it fails in the dangerous direction, since
// the mixed run LOOKS like a clean pass.
//
// TWO RULES, both paid for:
//   1. `process.env` WINS over `.env.local`. That is what makes an override an
//      override rather than a suggestion.
//   2. `.env.local` is OPTIONAL. CI has no such file; a hard `readFileSync`
//      turns "no local secrets" into an unhandled ENOENT that reads like a
//      broken tool rather than a missing credential.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCAL = fileURLToPath(new URL('../.env.local', import.meta.url));

/** Parse a dotenv-shaped file. Blank lines, `#` comments and quotes handled. */
function parseDotenv(text) {
  return Object.fromEntries(
    text.split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
}

/**
 * The merged environment. `.env.local` underneath, `process.env` on top.
 * @returns {{ env: Record<string,string>, fileEnv: Record<string,string>, hasLocal: boolean }}
 */
export function loadEnv() {
  const hasLocal = existsSync(LOCAL);
  const fileEnv = hasLocal ? parseDotenv(readFileSync(LOCAL, 'utf8')) : {};
  return { env: { ...fileEnv, ...process.env }, fileEnv, hasLocal };
}

const refOf = (url) => (url || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

/**
 * Which project will this call reach, and under which token.
 *
 * `label` is derived by COMPARING refs, never by trusting a variable name — a
 * tool that says "PRODUCTION" because it read the production variable is
 * describing its own input, not its target.
 *
 * @returns {{ ref: string, token: string, label: string, isProd: boolean, isDev: boolean }}
 */
export function resolveTarget(loaded = loadEnv()) {
  const { env, fileEnv } = loaded;
  const ref = refOf(env.VITE_SUPABASE_URL);
  const prodRef = refOf(fileEnv.VITE_SUPABASE_URL);
  const devRef = refOf(fileEnv.SUPABASE_DEV_URL || env.SUPABASE_DEV_URL);
  // The dev ref WINS. `prodRef` is only "whatever .env.local's default project
  // is", and a dev-only checkout (the night agent's, 2026-10-13: samo-dev is its
  // default and it holds no production credential) made both refs the same, so
  // samo-dev was announced as PRODUCTION. A ref that IS the dev project is never
  // production, whatever else the file says.
  const isDev = Boolean(ref) && ref === devRef;
  const isProd = Boolean(ref) && ref === prodRef && !isDev;
  // ⚠️ SAY "I DO NOT KNOW" RATHER THAN "NOT PRODUCTION". Without `.env.local`
  // there is nothing to compare production against, so `isProd` is false for
  // the production project itself — and a line reading "not the default
  // project" over a production connection is worse than no line at all. CI is
  // exactly that environment. `--dev` is unaffected: it refuses unless `isDev`
  // matches a ref it CAN resolve, so this is about honest labelling, not about
  // what is allowed to run.
  const canTell = Boolean(prodRef) || Boolean(devRef);
  const label = isProd ? 'PRODUCTION'
    : isDev ? 'samo-dev'
      : canTell ? 'not the default project'
        : 'unidentified — no local config to compare against';
  return { ref, token: env.SUPABASE_ACCESS_TOKEN, isProd, isDev, label };
}

/**
 * Print the target to STDERR and die if it is unusable.
 *
 * stderr on purpose: a proof's stdout is parsed as JSON by run-proofs.mjs, and
 * the runner reads this same line back to check the proof went where it was
 * SENT. Never move it to stdout.
 */
export function announceTarget(loaded = loadEnv()) {
  const t = resolveTarget(loaded);
  if (!t.ref || !t.token) {
    console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN (in .env.local or the environment)');
    process.exit(1);
  }
  console.error(`→ project: ${t.ref}  (${t.label})`);
  return t;
}

/** Management-API SQL, the one shape every proof here uses. */
export async function runSql(query, target) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${target.ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body}`);
  return body;
}
