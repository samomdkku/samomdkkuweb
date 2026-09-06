// ==============================================
// DB — Supabase client (single shared instance)
//
// Imports from Vite env vars. For local dev, set them in .env.local
// (gitignored). In production they are baked in at build time ON THE KKU VM by
// server/deploy.sh — Cloudflare Pages is retired, so its dashboard reaches
// nothing.
//
// The anon key is safe to ship in the bundle; RLS policies enforce
// security on the server. Don't ever expose the service-role key here.
// ==============================================

import { createClient } from '@supabase/supabase-js';
// One home for "PostgREST error body → something a human can read". The two
// guest forms fetch PostgREST without this client and share the same helper.
import { parseRestError } from './rest-error.js';
export { parseRestError };

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Hard-fail at module load. The site can't function without these and
  // a clear error is better than mysterious "fetch failed" later.
  // ⚠️ THIS MESSAGE USED TO NAME THE WRONG FILE AND THE WRONG VARIABLES.
  // It said "copy .env.example" — the VM's file, which a contributor must not
  // fill in — and named the two VITE_* names, which a contributor is never
  // sent. Somebody hitting this is a contributor, and the only useful thing to
  // tell them is the one command that diagnoses it (tools/env-check.mjs).
  console.error(
    '[db] No Supabase credentials. If you are running this locally, run '
    + '`npm run env:check` — it says which of SUPABASE_DEV_URL / '
    + 'SUPABASE_DEV_ANON_KEY is missing from .env.local and what to do. '
    + '(In production these are baked in on the VM.)'
  );
}

export const db = createClient(url || 'http://invalid', anonKey || 'invalid', {
  auth: {
    persistSession: true,
    // autoRefreshToken disabled by design. The supabase-js auto-refresh
    // sometimes stalls inline before a foreground request, hanging the
    // user's submit. We refresh proactively on a 25-minute interval
    // (well below the 1-hour JWT TTL) so the token never reaches the
    // "needs refresh now" state during a user action.
    autoRefreshToken: false,
    detectSessionInUrl: true,
  },
});

// Proactive refresh: keep the JWT fresh on a fixed interval so it never
// expires mid-submit. 25 min < 1 hour default TTL → plenty of margin.
// Skips refresh when there's no stored session — otherwise long-lived
// signed-out tabs emit a warn every 25 min for the missing-session error.
if (typeof window !== 'undefined') {
  const REFRESH_INTERVAL_MS = 25 * 60 * 1000;
  const projectRefForGate = (url || '').match(/\/\/([^.]+)\./)?.[1] || '';
  const sessionKeyForGate = projectRefForGate ? `sb-${projectRefForGate}-auth-token` : null;
  setInterval(() => {
    if (sessionKeyForGate && !localStorage.getItem(sessionKeyForGate)) return;
    db.auth.refreshSession().catch((e) => console.warn('[db] periodic refresh failed:', e?.message || e));
  }, REFRESH_INTERVAL_MS);
}

// Convenience: announcements bucket / file storage hooks would go here
// when we move from Drive to Supabase Storage. For now, file uploads
// stay on the GAS uploadPRFile endpoint (2 TB Drive quota).


// ============================================================
// dbRest — raw-fetch PostgREST helper
//
// Use this instead of db.from(...) for queries/mutations that have to
// be reliable. supabase-js's request layer has been stalling after the
// first call in a session despite extensive debugging (autoRefresh
// disabled, response bodies drained, etc.). Raw fetch sidesteps
// whatever internal state was going bad.
//
// Auth: pulls the current session's access token from localStorage.
// Falls back to anon key (RLS will still gate non-public reads).
//
// Returns Supabase-style { data, error } so call sites look familiar.
//
//   const { data, error } = await dbRest('/pr_tickets?id=eq.PR-ABC&select=*');
//   const { error }       = await dbRest('/pr_tickets', { method: 'POST', body: row });
//   const { error }       = await dbRest('/pr_tickets?id=eq.PR-ABC', { method: 'PATCH', body: { status: 'done' } });
// ============================================================

const PROJECT_REF = (url || '').match(/\/\/([^.]+)\./)?.[1] || '';
const SESSION_STORAGE_KEY = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

export function currentAccessToken() {
  if (!SESSION_STORAGE_KEY) return anonKey;
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return anonKey;
    const parsed = JSON.parse(stored);
    return parsed?.access_token || anonKey;
  } catch {
    return anonKey;
  }
}

/** Refresh the Supabase session JWT, deduping concurrent callers so we
 *  don't fire N parallel refresh round-trips when an expired token blows
 *  out N in-flight dbRest writes at once. Resolves to true on success,
 *  false otherwise (timed out, refresh_token revoked, no session). */
let inFlightRefresh = null;
async function refreshAccessTokenOnce() {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const { data, error } = await db.auth.refreshSession();
      if (error || !data?.session) return false;
      return true;
    } catch {
      return false;
    } finally {
      // Release after a microtask so callers chained behind this one
      // observe the result before the next refresh becomes possible.
      setTimeout(() => { inFlightRefresh = null; }, 0);
    }
  })();
  return inFlightRefresh;
}

/** True when the PostgREST error looks like a JWT-expired rejection
 *  (PGRST303). Used to decide whether to refresh-and-retry. Reads `code`
 *  and `raw` as well as `message` — PGRST303 is a CODE, and it stopped
 *  being part of `message` when parseRestError started unwrapping it. */
function isJwtExpiredError(error) {
  const status = error?.status;
  if (status !== 401 && status !== 403) return false;
  const m = `${error?.code || ''} ${error?.message || ''} ${error?.raw || ''}`.toLowerCase();
  return m.includes('pgrst303') || m.includes('jwt expired') || m.includes('jwt is expired');
}

export async function dbRest(path, opts = {}) {
  const {
    method = 'GET',
    body,
    headers: extraHeaders = {},
    timeout = 15000,
    prefer,
  } = opts;
  const doFetch = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = {
        apikey: anonKey,
        Authorization: `Bearer ${currentAccessToken()}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...extraHeaders,
      };
      const res = await fetch(`${url}/rest/v1${path}`, {
        method,
        headers,
        body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: controller.signal,
        // iPad / iOS Safari aggressively caches GET responses to the
        // same URL when the page is restored from bfcache or the tab is
        // backgrounded. cache:'no-store' is the right answer on modern
        // Safari (16.4+). PostgREST itself sets Cache-Control: no-store
        // on responses so the browser shouldn't store them in the first
        // place — the bfcache `pageshow` reload handler in projects/
        // index.js covers the in-memory restore case independently. Do
        // NOT try to cache-bust via query string: PostgREST parses
        // every unknown param as a filter and 400s on `?_=…`.
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { data: null, error: parseRestError(res.status, text, res.statusText) };
      }
      const data = res.status === 204
        ? null
        : await res.json().catch(() => null);
      return { data, error: null };
    } catch (e) {
      clearTimeout(timer);
      return { data: null, error: { message: e?.message || String(e), name: e?.name } };
    }
  };

  const first = await doFetch();
  // JWT-expired retry: the 25-min proactive refresh in db.js can miss when
  // the tab was backgrounded / throttled (mobile Safari especially), or
  // when the user spent >1hr typing in a modal before submitting. Trying
  // a refresh-and-retry here is cheap and turns "PGRST303 JWT expired"
  // into a transparent recovery instead of a "บันทึกไม่สำเร็จ" toast.
  if (first.error && isJwtExpiredError(first.error)) {
    const refreshed = await refreshAccessTokenOnce();
    if (refreshed) return doFetch();
  }
  return first;
}
