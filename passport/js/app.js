// js/app.js
import { createClient } from "@supabase/supabase-js";
// Every read is fetched in FULL past PostgREST's 1,000-row cap. Without it the
// leaderboards saw 1,000 of 1,352 scans and froze (2026-10-23) — header of
// src/js/rest-pages.js. Both clients below take it; row-cap.test.js checks.
import { pagedFetch } from "../../src/js/rest-pages.js";

const restFetch = pagedFetch((...args) => fetch(...args));

// FROM THE BUILD ENVIRONMENT ONLY — the same two values as the portal (db.js).
// Passport data lives in the isolated `passport` schema of samoweb's project,
// so the portal and Passport share one sign-in.
//
// ⛔ NO FALLBACK ADDRESS. There used to be one: PRODUCTION, hardcoded. A build
// made without these values (a contributor's checkout, a preview whose env was
// not mapped, a vite `envDir` mistake like the one that blanked every VITE_* in
// 2026-09) then read and wrote REAL student data while looking like a test
// site. Removed 2026-11-01; such a build now fails visibly, like db.js does.
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error(
        '[passport] No Supabase credentials in this build. Locally, run '
        + '`npm run env:check`. (In production these are baked in on the VM.)'
    );
}

export let supabase;
try {
    // `db.schema: 'passport'` routes every supabase.from(...) to the passport
    // schema (all query surfaces: activities/scans/profiles/samo_seasons/
    // samo_years/certificates/user_tiers). Auth stays on the shared project.
    supabase = createClient(SUPABASE_URL || 'http://invalid', SUPABASE_ANON_KEY || 'invalid', { db: { schema: "passport" }, global: { fetch: restFetch } });
} catch (err) {
    console.error("Failed to initialize Supabase:", err);
}

// ── The legacy-admin client ──────────────────────────────────────────────────
// The temporary admin/1234 door needs a REAL Supabase session, because the
// database can only grant rights to an identity it can verify (see
// js/admin-scope.js for the whole story). It signs into ONE shared account.
//
// It gets its OWN client with its OWN storageKey, deliberately. Sessions are
// keyed by storageKey in localStorage, so sharing the default key would mean an
// organiser opening the admin panel silently replaces their own Google session
// on that browser — logging them out of their personal passport, and swapping
// the identity the dashboard and scan pages see. Two keys, two independent
// sessions, no interference in either direction.
let legacyClient = null;
export function getLegacyAdminClient() {
    if (!legacyClient) {
        legacyClient = createClient(SUPABASE_URL || 'http://invalid', SUPABASE_ANON_KEY || 'invalid', {
            db: { schema: "passport" },
            global: { fetch: restFetch },
            auth: { storageKey: "sb-passport-legacy-admin", detectSessionInUrl: false },
        });
    }
    return legacyClient;
}

// ── adminDb: which client the admin panel's DATA calls should use ─────────────
// A live binding, so reassigning it here updates every importer (ES modules
// export bindings, not copies). admin-page.js does its reads/writes through
// `adminDb` and its Google sign-in through `supabase`, so one line switches the
// whole panel onto the legacy session without touching 20 call sites.
export let adminDb = supabase;
export function useLegacyAdminDb() { adminDb = getLegacyAdminClient(); }
export function useNormalAdminDb() { adminDb = supabase; }

