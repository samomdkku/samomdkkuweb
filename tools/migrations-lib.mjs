// ============================================================
// migrations-lib.mjs — ONE home for the things every migration tool needs.
//
// apply-migration.mjs, migrate-status.mjs and migrate-new.mjs all need to
// answer "which project", "what are the files", "what number is this" and
// "run this SQL". Three copies of those answers is the drift class this repo
// pays for most, so they live here once.
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const MIGRATIONS_DIR = 'supabase/migrations';

/** .env.local parser — no dependency, same rules as apply-migration.mjs had. */
export function loadEnvLocal(path = '.env.local') {
  const env = {};
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = v;
  }
  return env;
}

export function projectRefFromUrl(url) {
  const m = String(url || '').match(/^https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/i);
  return m ? m[1] : null;
}

/** '0169_a_slug.sql' → '0169'. Returns null for anything not numbered. */
export function versionOf(filename) {
  const m = /^(\d{4})_/.exec(filename);
  return m ? m[1] : null;
}

/** Every numbered .sql in the migrations directory, sorted by version. */
export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && versionOf(f))
    .sort()
    .map((name) => ({ name, version: versionOf(name), path: join(dir, name) }));
}

export function checksumOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/** Single-quote escaping for values interpolated into a SQL literal. */
export function sqlLit(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Run SQL through the Supabase Management API and return the parsed rows.
 * Throws on a non-2xx so every caller fails loudly rather than continuing on
 * an error body it never looked at.
 */
export async function runSql(sql, { ref, token }) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return []; }
}

/**
 * Resolve the project + token, or exit with the setup instructions.
 *
 * WHICH DATABASE: `--dev` on the command line, or SAMO_TARGET=dev, selects the
 * samo-dev project. Default is PRODUCTION — deliberately, because a tool that
 * silently defaults to dev is a tool that reports production as healthy while
 * looking somewhere else. Every caller prints which one it chose.
 */
export function credentials(argv = process.argv) {
  const env = { ...loadEnvLocal(), ...process.env };
  const dev = argv.includes('--dev') || env.SAMO_TARGET === 'dev';
  const url = dev ? env.SUPABASE_DEV_URL : env.VITE_SUPABASE_URL;
  const token = dev ? env.SUPABASE_DEV_ACCESS_TOKEN : env.SUPABASE_ACCESS_TOKEN;
  const label = dev ? 'samo-dev' : 'PRODUCTION';
  const ref = projectRefFromUrl(url);
  if (!ref) {
    console.error(`could not derive the project ref from ${dev ? 'SUPABASE_DEV_URL' : 'VITE_SUPABASE_URL'} in .env.local`);
    process.exit(1);
  }
  if (!token) {
    console.error(
      `${dev ? 'SUPABASE_DEV_ACCESS_TOKEN' : 'SUPABASE_ACCESS_TOKEN'} missing from .env.local.\n` +
      '  https://supabase.com/dashboard/account/tokens → Generate new token',
    );
    process.exit(1);
  }
  return { ref, token, env, dev, label };
}

/**
 * Record a successful apply. Never throws — a migration that ran must not be
 * reported as failed because the bookkeeping afterwards did not.
 */
export async function recordApplied(file, { ref, token, by }) {
  const version = versionOf(file.replace(/^.*\//, ''));
  if (!version) return { ok: false, why: 'not a numbered migration' };
  const name = file.replace(/^.*\//, '');
  const sql = `
    insert into public.schema_migrations (version, name, source, applied_at, applied_by, checksum)
    values (${sqlLit(version)}, ${sqlLit(name)}, 'applied', now(), ${sqlLit(by)}, ${sqlLit(checksumOf(file))})
    on conflict (version) do update
      set name = excluded.name, source = 'applied',
          applied_at = excluded.applied_at, applied_by = excluded.applied_by,
          checksum = excluded.checksum;`;
  try {
    await runSql(sql, { ref, token });
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/**
 * What does a database NOT have yet?
 *
 * ⛔ ONE HOME. `migrate-status.mjs` reports this and `deploy-owed.mjs` warns
 * about it; two copies of "pending means a file with no row" would drift, and
 * the copy that drifts is the one that says everything is fine
 * (`.claude/rules/mistakes.md` class 6). Both call this.
 *
 * Returns `{ pending, changed }` — files never recorded, and files whose
 * content no longer matches what was recorded.
 */
export async function pendingMigrations({ ref, token }) {
  const files = listMigrationFiles();
  const rows = await runSql(
    'select version, checksum from public.schema_migrations order by version;',
    { ref, token },
  );
  const byVersion = new Map(rows.map((r) => [r.version, r]));
  return {
    files,
    pending: files.filter((f) => !byVersion.has(f.version)),
    changed: files.filter((f) => {
      const r = byVersion.get(f.version);
      return r && r.checksum && r.checksum !== checksumOf(f.path);
    }),
  };
}
