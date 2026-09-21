// ==============================================
// AUTH — Global Supabase-backed sign-in
//
// Single source of truth for the signed-in user across the site.
// Wraps Supabase Auth (Google JWT, email/password) and maintains an
// app-level "currentUser" object enriched from public.users (role,
// department, username, method).
//
// Subscribers via onAuthChange react to user changes.
// ==============================================

import { db, dbRest } from './db.js';
import { decodeJwtResponse } from './utils.js';
import { PREVIEW_SCOPE_NOTE } from './env-ribbon.js';
import { ribbonLabel } from './env-ribbon.js';

// ============================================================
// Username convention for password accounts
//
// Supabase Auth requires an email. Our app supports username-only sign-up
// for users who don't want to share an email. We synthesize an email
// internally: "<username>@samomdkku.app". The user only ever sees /
// types their username; the synthetic email is transparent.
//
// Note: we use .app (not .local) because Supabase Auth rejects RFC 6762
// reserved TLDs like .local with "Email address is invalid". .app is a
// real public TLD (owned by Google); we never actually deliver mail to
// it — the format just needs to validate.
// ============================================================

const PASSWORD_EMAIL_DOMAIN = 'samomdkku.app';

function usernameToEmail(username) {
  return `${username.toLowerCase().trim()}@${PASSWORD_EMAIL_DOMAIN}`;
}

// ============================================================
// State + subscribers
// ============================================================

let currentUser = null;
const subscribers = new Set();
const beforeSignOutHooks = new Set();

// Resolves once initAuth() has restored (or confirmed the absence of) a
// session from storage. Lets app shells distinguish "we don't know yet, a
// token may still be loading" from "confirmed signed out" — so a slow
// mobile session restore shows the boot spinner instead of flashing the
// sign-in gate. See admin-main.js boot gating.
let markAuthReady;
export const authReady = new Promise((resolve) => { markAuthReady = resolve; });

// localStorage key supabase-js persists the session under, derived from the
// project ref in the URL (e.g. sb-fheueuowbchsnsvbcgil-auth-token).
const PERSISTED_SESSION_KEY = (() => {
  try {
    const ref = (import.meta.env.VITE_SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1] || '';
    return ref ? `sb-${ref}-auth-token` : null;
  } catch { return null; }
})();

/** True when supabase-js has a persisted session token in localStorage.
 *  The token may be expired (but still refreshable) — this only answers
 *  "a sign-in MIGHT be restorable", used to keep the boot spinner up while
 *  initAuth() resolves rather than flashing the sign-in gate on slow
 *  mobile connections. */
export function hasPersistedSession() {
  if (!PERSISTED_SESSION_KEY) return false;
  try { return !!localStorage.getItem(PERSISTED_SESSION_KEY); }
  catch { return false; }
}

function notify() {
  for (const cb of subscribers) {
    try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  }
}

/**
 * Register a callback that runs synchronously with the CURRENT user
 * *before* signOut() clears it. Used by account-switch to snapshot the
 * outgoing account into the saved-accounts list — the onAuthChange
 * subscriber would otherwise see only `null` (the post-clear state)
 * and have no way to know who just left. Returns an unsubscribe fn.
 */
export function onBeforeSignOut(cb) {
  beforeSignOutHooks.add(cb);
  return () => beforeSignOutHooks.delete(cb);
}

// ============================================================
// User profile assembly
//
// `currentUser` = auth session info + public.users row, flattened.
// ============================================================

/** Read identity providers off the auth session. Used by the profile
 *  modal to decide whether to show "Link Google" or "Google already
 *  connected". Supabase exposes auth.users.identities[] — each entry has
 *  a provider (google | email) and per-provider data.
 *  Returns { hasPassword: bool, hasGoogle: bool, googleEmail: string|null }. */
function readIdentities(authUser) {
  const list = Array.isArray(authUser?.identities) ? authUser.identities : [];
  let hasPassword = false;
  let hasGoogle = false;
  let googleEmail = null;
  for (const id of list) {
    if (id?.provider === 'email') hasPassword = true;
    if (id?.provider === 'google') {
      hasGoogle = true;
      googleEmail = id?.identity_data?.email || googleEmail;
    }
  }
  // Stash the full identity list so the unlink helpers can hand the
  // exact object back to db.auth.unlinkIdentity(identity). We also
  // surface providersCount so callers can enforce "always leave at
  // least one way to sign in" before unlinking anything.
  return {
    hasPassword,
    hasGoogle,
    googleEmail,
    identities: list,
    providersCount: list.length,
  };
}

async function buildCurrentUser(session) {
  if (!session?.user) return null;
  const authUser = session.user;
  // Called from inside an onAuthStateChange callback (deferred via the
  // setTimeout(0) wrapper in initAuth). On some browsers — notably
  // Android Chrome — the supabase-js .from(...).select(...) path here
  // hangs even after the session lock is supposed to be released,
  // leaving the sign-in modal open with no error: the spinner returns
  // to "เข้าสู่ระบบ" because db.auth.signInWithPassword has resolved,
  // but currentUser is never populated so the auth subscriber never
  // closes the modal. See mistakes.md "supabase-js gets into a bad
  // state — bypass with dbRest()". Use dbRest here so the auth wake-
  // up never depends on supabase-js's PostgREST client state.
  const baseSelect = 'id,email,username,display_name,method,role,department';
  const idEsc = encodeURIComponent(authUser.id);
  let profile = null;
  {
    // Try with the latest schema (permissions from 0010, has_password
    // from 0027). Fall back step-wise so pre-migration databases still
    // build a usable currentUser.
    let { data, error } = await dbRest(
      `/users?id=eq.${idEsc}&select=${baseSelect},permissions,managed_permissions,managed_vs_depts,managed_project_seats,managed_dept_pages,has_password,phone&limit=1`,
    );
    if (error && error.status === 400 && /managed_dept_pages/i.test(error.message || '')) {
      // 0177 not applied on this database. Same shape as every column below:
      // drop it and retry, so an older database still signs people in.
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions,managed_permissions,managed_vs_depts,managed_project_seats,has_password,phone&limit=1`,
      ));
    }
    if (error && error.status === 400 && /managed_project_seats/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthSeats) {
        window.__samoWarnedAuthSeats = true;
        console.warn('[auth] managed_project_seats column missing — apply migration 0086 to enable หนังสือโครงการ seats.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions,managed_permissions,managed_vs_depts,has_password,phone&limit=1`,
      ));
    }
    if (error && error.status === 400 && /managed_vs_depts/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthVsDepts) {
        window.__samoWarnedAuthVsDepts = true;
        console.warn('[auth] managed_vs_depts column missing — apply migration 0082 to enable per-ฝ่าย VitalSound scope.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions,managed_permissions,has_password,phone&limit=1`,
      ));
    }
    if (error && error.status === 400 && /managed_permissions/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthManagedPerms) {
        window.__samoWarnedAuthManagedPerms = true;
        console.warn('[auth] managed_permissions column missing — apply migration 0081 to enable SAMO Team permission sync.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions,has_password,phone&limit=1`,
      ));
    }
    if (error && error.status === 400 && /phone/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthPhone) {
        window.__samoWarnedAuthPhone = true;
        console.warn('[auth] phone column missing — apply migration 0036 to enable the contact-phone field + samoshop autofill.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions,has_password&limit=1`,
      ));
    }
    if (error && error.status === 400 && /has_password/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthHasPassword) {
        window.__samoWarnedAuthHasPassword = true;
        console.warn('[auth] has_password column missing — apply migration 0027 for reliable password UI gating.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect},permissions&limit=1`,
      ));
    }
    if (error && error.status === 400 && /permissions/i.test(error.message || '')) {
      if (!window.__samoWarnedAuthPermissions) {
        window.__samoWarnedAuthPermissions = true;
        console.warn('[auth] permissions column missing — apply migration 0010_vp_accounts_permissions.sql to enable per-account feature gates.');
      }
      ({ data, error } = await dbRest(
        `/users?id=eq.${idEsc}&select=${baseSelect}&limit=1`,
      ));
    }
    if (Array.isArray(data) && data.length > 0) profile = data[0];
  }

  // SAMO Team permission sync (migration 0081): resolve this account's
  // kkumail against the org tree and write the tree-derived perms into
  // public.users.managed_permissions. Keyed off auth.uid() server-side —
  // no client-trusted input. dbRest (not supabase-js) for the same
  // reason buildCurrentUser avoids the supabase-js PostgREST client here.
  // Best-effort: on any failure managed perms fall back to the profile
  // row value (or [] pre-0081), so login never depends on the sync.
  try {
    const { data: synced, error: syncErr } = await dbRest(
      '/rpc/sync_my_team_permissions', { method: 'POST', body: {} },
    );
    if (!syncErr && profile && synced) {
      if (Array.isArray(synced)) {
        // pre-0082 shape (text[] of permissions only)
        profile.managed_permissions = synced;
      } else if (typeof synced === 'object') {
        // 0082+ shape: { permissions, vs_depts } — 0086 adds project_seats.
        if (Array.isArray(synced.permissions)) profile.managed_permissions = synced.permissions;
        if (Array.isArray(synced.vs_depts)) profile.managed_vs_depts = synced.vs_depts;
        if (Array.isArray(synced.project_seats)) profile.managed_project_seats = synced.project_seats;
        // 0177. Missing on a database that predates it — the guard is
        // Array.isArray, so an older RPC simply leaves the profile value.
        if (Array.isArray(synced.dept_pages)) profile.managed_dept_pages = synced.dept_pages;
      }
    }
  } catch (_) { /* ignore — managed perms fall back to the profile value */ }

  // Profile may be null briefly right after signup if the create-on-trigger
  // hasn't fired (or for unusual race conditions). Fall back to auth data.
  const identities = readIdentities(authUser);
  // Email shown to the user: prefer the auth.users.email when it is
  // a real address. Synthetic <username>@samomdkku.app is hidden from
  // the UI — it's an implementation detail.
  const rawEmail = profile?.email || authUser.email || '';
  const isSynthetic = rawEmail.toLowerCase().endsWith(`@${PASSWORD_EMAIL_DOMAIN}`);
  const emailConfirmed = !!authUser.email_confirmed_at && !isSynthetic;
  return {
    id: authUser.id,
    method: profile?.method || (authUser.app_metadata?.provider === 'google' ? 'google' : 'password'),
    username: profile?.username || authUser.user_metadata?.username || '',
    email: isSynthetic ? '' : rawEmail,
    emailVerified: emailConfirmed,
    // Pending email change kicked off by db.auth.updateUser({email}).
    // While Supabase waits for the user to click the magic link the
    // new value lives at authUser.new_email (and auth.users.email_change).
    pendingEmail: authUser.new_email || '',
    // `has_password` from public.users (migration 0027) is the reliable
    // source — it's a mirror of auth.users.encrypted_password updated by
    // trigger. The identity-array heuristic stays as a fallback for
    // pre-0027 databases so the UI doesn't lock new accounts out.
    hasPassword: typeof profile?.has_password === 'boolean'
      ? profile.has_password
      : identities.hasPassword,
    hasGoogle: identities.hasGoogle,
    googleEmail: identities.googleEmail,
    identities: identities.identities,
    name: profile?.display_name || authUser.user_metadata?.display_name || authUser.user_metadata?.name || '',
    picture: authUser.user_metadata?.picture || authUser.user_metadata?.avatar_url || '',
    sub: authUser.user_metadata?.sub || authUser.id,
    role: profile?.role || 'user',
    department: profile?.department || '',
    // Contact phone (migration 0036). Used to autofill the samoshop
    // checkout buyer-phone field. Empty string when unset / pre-migration.
    phone: profile?.phone || '',
    permissions: Array.isArray(profile?.permissions) ? profile.permissions : [],
    // Tree-derived perms from the SAMO Team org tree (migration 0081).
    // Stacks with `permissions` at the gate — see userCanAccess().
    managedPermissions: Array.isArray(profile?.managed_permissions) ? profile.managed_permissions : [],
    // Per-ฝ่าย VitalSound scope from the SAMO Team tree (migration 0082).
    // Non-empty ⇒ VS access limited to these target_depts (see userCanAccess).
    managedVsDepts: Array.isArray(profile?.managed_vs_depts) ? profile.managed_vs_depts : [],
    // หนังสือโครงการ seats from the SAMO Team tree (migration 0086):
    // 'vpa' (ผู้ส่ง) | 'staff' (เจ้าหน้าที่คณะ) | 'prof' (อาจารย์ ลงนาม).
    // Non-empty ⇒ projects access; the seat decides WHICH workflow they get
    // (see projectSeatRole() in projects/index.js).
    managedProjectSeats: Array.isArray(profile?.managed_project_seats) ? profile.managed_project_seats : [],
    // Which ฝ่าย pages this account may edit (0177). Empty = none, and the
    // BLANKET grant is the `dept_pages` permission instead — the two are
    // exclusive, mirroring current_user_dept_page_scope().
    managedDeptPages: Array.isArray(profile?.managed_dept_pages) ? profile.managed_dept_pages : [],
    // Password field intentionally absent — Supabase manages auth state.
  };
}

/**
 * Does the current user have access to a given feature key?
 * - Role-based defaults:
 *     pr_staff    → 'pr'
 *     vs_staff    → 'vs' (super; see all depts)
 *     shop_admin  → 'samoshop'
 *     vp_admin    → 'vs' only (own dept; DB RLS gates per-dept).
 *                   Projects is NOT a vp_admin default — only the
 *                   account(s) with 'projects' in permissions[] see it.
 *     uni_staff   → 'projects'
 *     sa_prof     → 'projects' (professor signing seat; RLS narrows
 *                   his view to only หนังสือ sent to him)
 *     dev         → everything
 * - Plus anything in user.permissions (manual grants) OR
 *   user.managedPermissions (SAMO Team tree, migration 0081) stacks on
 *   top. The DB gate current_user_has_permission() reads the same union.
 *
 * Use this for UI gating; the database RLS is the real boundary.
 */
/**
 * Does this account hold `master` (migration 0111) — the key that answers yes to
 * every permission?
 *
 * Extracted so `userCanAccess()` and the callers that need the key ITSELF share
 * one test. A second hand-rolled `permissions.includes('master')` somewhere else
 * is the drift class this repo pays for most, and this one has two channels to
 * get wrong: `permissions` AND `managed_permissions` (0081). `dev` is included
 * because the role short-circuits every gate above anyway, so excluding it here
 * would make "holds master" and "is treated as master" two different answers.
 *
 * This mirrors SQL's `current_user_has_permission()` exactly.
 */
export function holdsMaster(user = currentUser) {
  if (!user) return false;
  if (user.role === 'dev') return true;
  return (Array.isArray(user.permissions) && user.permissions.includes('master'))
      || (Array.isArray(user.managedPermissions) && user.managedPermissions.includes('master'));
}

export function userCanAccess(feature, user = currentUser) {
  if (!user) return false;
  if (user.role === 'dev') return true;
  // `master` (migration 0111) answers yes to every permission, from either
  // channel. This mirrors the SQL side EXACTLY — current_user_has_permission()
  // does the same test — and it is the only place JS knows about the key, so
  // the two cannot drift feature by feature.
  if (holdsMaster(user)) return true;
  const roleDefaults = {
    pr_staff:   ['pr'],
    vs_staff:   ['vs'],
    shop_admin: ['samoshop'],
    // `team_edit` as well as `team` (0110): the RLS write policy admits
    // vp_admin by ROLE, so a UI that only granted them the view rung would
    // render the tree read-only for someone the database lets write — the
    // same UI/DB mismatch that made the `team` permission look broken in 0089.
    vp_admin:   ['vs', 'team', 'team_edit'],
    uni_staff:  ['projects'],
    sa_prof:    ['projects'],
  }[user.role] || [];
  if (roleDefaults.includes(feature)) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes(feature)) return true;
  if (Array.isArray(user.managedPermissions) && user.managedPermissions.includes(feature)) return true;
  // Per-ฝ่าย VitalSound (0082): a scoped VS-dept grant opens the VS tab —
  // the ticket rows themselves are then dept-filtered by RLS.
  if (feature === 'vs' && Array.isArray(user.managedVsDepts) && user.managedVsDepts.length > 0) return true;
  // หนังสือโครงการ seat (0086): any granted seat opens the tab; the seat then
  // decides which controls render and RLS scopes what they can write.
  if (feature === 'projects' && Array.isArray(user.managedProjectSeats)
      && user.managedProjectSeats.length > 0) return true;
  // Per-ฝ่าย page editing (0177). Same shape as the two above, and the same
  // reason: a person scoped to ONE ฝ่าย holds no `dept_pages` permission at
  // all, so without this line the database would let them edit their page and
  // the UI would never show it to them. That gap — a new access channel
  // threaded through the writes but not the gate — is the most repeated bug in
  // this repo (class 5).
  if (feature === 'dept_pages' && Array.isArray(user.managedDeptPages)
      && user.managedDeptPages.length > 0) return true;
  return false;
}

// ============================================================
// Public API
// ============================================================

export async function initAuth() {
  // Pull current session (Supabase restores from storage automatically).
  const { data: { session } } = await db.auth.getSession();
  currentUser = await buildCurrentUser(session);
  notify();
  // Session restore (or its confirmed absence) is now settled — let any
  // boot gate stop waiting. Fires AFTER notify() so subscribers already
  // hold the restored user when authReady resolvers run.
  markAuthReady?.();

  // React to auth state changes (sign in / out / token refresh).
  //
  // CRITICAL: any async supabase-js call made INSIDE this callback will
  // deadlock the session lock and hang every subsequent supabase call.
  // This is a known supabase-js bug, ~2 years old:
  //   https://github.com/supabase/auth-js/issues/762
  //
  // The official workaround is to defer the work with setTimeout(0) so
  // it runs after the auth-state callback has returned and released
  // the lock. We MUST keep this wrapper — removing it brings back the
  // "form submit stuck on loading" hang.
  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(async () => {
      currentUser = await buildCurrentUser(session);
      notify();
    }, 0);
  });
}

/**
 * Sign in with Google via Supabase's OAuth redirect flow. The browser
 * navigates to Google's consent screen, then to the Supabase callback,
 * then back to the app with a session attached to the URL (Supabase
 * client picks it up automatically via detectSessionInUrl).
 *
 * Returns a thenable: callers don't actually await the resolution since
 * the navigation happens immediately. onAuthStateChange fires when the
 * user lands back on the app.
 */
/**
 * Kick off the Google OAuth roundtrip.
 * @param {{ loginHint?: string }} [opts] — pass an email to skip Google's
 *  account chooser (used by the account-switcher to jump straight to
 *  the previously-signed-in Google account).
 */
/**
 * Is Google sign-in actually configured on the project this build talks to?
 *
 * WHY THIS EXISTS. `signInWithOAuth` does not validate the provider — it builds
 * the `/authorize` URL and navigates. So on a deployment where Google is not
 * enabled, the browser LEAVES our app and lands on a raw Supabase error:
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * Reported from a preview on 2026-08-29. Nothing in our code runs at that
 * point, so there is no error to catch after the fact — the only place to say
 * anything useful is BEFORE the navigation.
 *
 * ⚠️ FAILS OPEN, DELIBERATELY, AND ONLY RUNS OFF PRODUCTION. Two rules:
 *
 *   1. Production takes this path unchanged and makes NO extra request. The
 *      problem exists only on samo-dev; adding a network hop in front of the
 *      live site's main sign-in button to fix a preview's message would be a
 *      bad trade.
 *   2. Anywhere else, if the check cannot get an answer — offline, a 500, a
 *      shape we do not recognise — we proceed to Google exactly as before.
 *      A blocked sign-in is far worse than an ugly error page, so "unknown"
 *      must never mean "no".
 */
let googleEnabled = null;
async function googleSignInAvailable() {
  // ribbonLabel(null) on production; any non-null value means this is not it.
  if (!ribbonLabel(import.meta.env.VITE_ENV_NAME, location.hostname)) return true;
  if (googleEnabled !== null) return googleEnabled;
  try {
    const base = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!base || !key) return true;
    const r = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: key } });
    if (!r.ok) return true;
    const j = await r.json();
    // Only a definite `false` counts. A missing key is not a denial.
    googleEnabled = j?.external?.google !== false;
    return googleEnabled;
  } catch {
    return true;
  }
}

export async function signInWithGoogle(opts = {}) {
  if (!(await googleSignInAvailable())) {
    // The parenthetical said the DATA is not real. It is — samo-dev is an
    // unmasked copy. What is true is that edits here do not reach production,
    // which is what PREVIEW_SCOPE_NOTE says, in the one place it is written.
    throw new Error('เวอร์ชันทดสอบนี้ยังไม่เปิดให้เข้าสู่ระบบด้วย Google '
      + `— ใช้ Username และ Password แทนได้เลย (${PREVIEW_SCOPE_NOTE})`);
  }
  const oauthOptions = {
    // Land back on the current page after Google returns.
    redirectTo: window.location.origin + window.location.pathname,
  };
  if (opts.loginHint) {
    oauthOptions.queryParams = { login_hint: opts.loginHint };
  }
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: oauthOptions,
  });
  if (error) {
    console.error('[auth] Google OAuth start failed:', error.message);
    throw new Error(error.message);
  }
}

/**
 * Legacy Google One Tap credential handler. Kept for the existing
 * data-callback="handlePrGoogleLogin" wiring; in the new flow this is
 * unused but harmless if invoked. Prefer signInWithGoogle().
 */
export async function signInWithCredential(credential) {
  const payload = decodeJwtResponse(credential);
  const { error } = await db.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
  });
  if (error) {
    console.error('[auth] ID-token sign-in failed:', error.message);
    throw new Error(error.message);
  }
  return payload;
}

export async function signInWithPassword(rawUsername, rawPassword) {
  const username = (rawUsername || '').trim();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');

  // Resolve the auth email for what the user typed:
  //   - input contains '@' → treat as an email, use directly
  //   - otherwise → look it up via the username→email RPC, falling
  //     back to the synthetic `<username>@samomdkku.app` so pre-0026
  //     databases and brand-new accounts still work.
  let email;
  if (username.includes('@')) {
    email = username.toLowerCase();
  } else {
    email = usernameToEmail(username);
    try {
      const { data, error } = await dbRest('/rpc/lookup_email_by_username', {
        method: 'POST',
        body: { p_username: username },
      });
      if (!error && typeof data === 'string' && data.includes('@')) {
        email = data;
      }
    } catch {
      // network blip — synthetic fallback is fine.
    }
  }

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns generic "Invalid login credentials". Translate.
    //
    // A REAL email typed here is almost always an account made with the Google
    // button — 550 of them on 2026-09-21, none with a password, because Google
    // sign-up never sets one. "Username หรือ Password ไม่ถูกต้อง" told them they
    // mistyped, so they retried (often with their university mail password,
    // which this site never had). Say what is actually likely, and the way in.
    // Deliberately NOT a server lookup of "does this email have a password":
    // that would answer, for any address, whether it holds an account here.
    if (username.includes('@') && !email.endsWith(`@${PASSWORD_EMAIL_DOMAIN}`)) {
      throw new Error('รหัสผ่านไม่ถูกต้อง หรือบัญชีนี้ยังไม่มีรหัสผ่าน — '
        + 'ถ้าเคยเข้าด้วยปุ่ม Google ให้กดปุ่ม Google แทน '
        + '(ตั้งรหัสผ่านเพิ่มได้ที่หน้าโปรไฟล์หลังเข้าสู่ระบบ)');
    }
    throw new Error('Username หรือ Password ไม่ถูกต้อง');
  }
  // Belt-and-braces: explicitly populate currentUser and notify
  // subscribers right here instead of relying purely on the
  // onAuthStateChange listener. On Android Chrome the supabase-js
  // client occasionally drops the SIGNED_IN event after a previous
  // logout cycle (in-memory state goes stale; fresh tab fixes it).
  // When the listener does fire, this is idempotent.
  if (data?.session) {
    currentUser = await buildCurrentUser(data.session);
    notify();
  }
  return currentUser;
}

export async function registerWithPassword(rawUsername, rawPassword) {
  // Lowercase at the door so the unique-username constraint isn't
  // accidentally bypassed by a case difference. The synthetic email
  // path already lowercases — this aligns public.users.username with
  // the lookup-by-username RPC (which compares case-insensitively).
  const username = (rawUsername || '').trim().toLowerCase();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (username.length < 3) throw new Error('Username ต้องมีอย่างน้อย 3 ตัวอักษร');
  if (password.length < 6) throw new Error('Password ต้องมีอย่างน้อย 6 ตัวอักษร');
  // Block reserved staff usernames. All staff accounts in this app
  // follow the `samomdkku*` convention (samomdkkupr, samomdkkuvssound,
  // samomdkkushop, the 10 VP accounts samomdkkuvpa / samomdkkudigital /
  // samomdkkumdi / …) plus the legacy `sastaff` / `samomdkkudev`.
  // Use a prefix check so a brand-new dept account (e.g. a future
  // samomdkku<x>) can't be squatted before the admin seeds it.
  // Backend uniqueness on public.users.username is the second line of defence.
  if (/^samomdkku/.test(username) || username === 'sastaff' || username === 'saprof') {
    throw new Error('Username นี้สงวนไว้สำหรับเจ้าหน้าที่');
  }

  const email = usernameToEmail(username);
  const { error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        method: 'password',
        username,
        display_name: username,
      },
    },
  });
  if (error) {
    if (error.message?.toLowerCase().includes('already')) {
      throw new Error('Username นี้มีผู้ใช้งานแล้ว');
    }
    throw new Error(error.message || 'สมัครสมาชิกไม่สำเร็จ');
  }
  return currentUser;
}

/**
 * @param {{ scope?: 'global' | 'local' | 'others' }} [opts]
 *   `local` (account-switcher's "+ Add another" path) clears the
 *   current device's session but does NOT revoke the refresh_token
 *   on the server — so a saved refresh_token can still be replayed
 *   later to fast-switch back. `global` (the explicit ออกจากระบบ
 *   button) revokes the token across all of the user's devices.
 */
export async function signOut(opts = {}) {
  // Run any pre-clear hooks while currentUser is still populated, so
  // account-switch (and similar bookkeeping) can snapshot the outgoing
  // user without racing the auth subscriber.
  for (const cb of beforeSignOutHooks) {
    try { cb(currentUser); } catch (e) { console.error('beforeSignOut hook error', e); }
  }
  // Optimistic local clear so the UI updates immediately, even if the
  // server-side revoke call hangs or fails. onAuthStateChange will also
  // fire when the actual signOut completes — currentUser is already null
  // so it's effectively a no-op then.
  currentUser = null;
  notify();
  try {
    await db.auth.signOut(opts.scope ? { scope: opts.scope } : undefined);
  } catch (e) {
    console.warn('[auth] signOut server call failed (local session already cleared):', e);
  }
}

export function getUser() { return currentUser; }
export function isSignedIn() { return currentUser !== null; }
export function getRole() { return currentUser?.role || null; }
export function getDepartment() { return currentUser?.department || ''; }

/**
 * Read the current Supabase session's tokens. Used by the multi-account
 * switcher to snapshot a session so we can replay it later for "fast
 * switch" without forcing the user back through the sign-in form.
 * Returns null when no session is active.
 */
export async function getCurrentSessionTokens() {
  try {
    const { data } = await db.auth.getSession();
    const s = data?.session;
    return s ? {
      access_token:  s.access_token,
      refresh_token: s.refresh_token,
    } : null;
  } catch { return null; }
}

/**
 * Replay a previously-saved Supabase session — used by the account
 * switcher to swap to a different account without re-entering the
 * password. supabase-js auto-refreshes the access_token from the
 * refresh_token when the former is expired, so a session saved hours
 * (or days) ago is still usable as long as the refresh_token is valid.
 *
 * Returns the rebuilt currentUser, or null on failure.
 */
export async function setAuthSession({ access_token, refresh_token }, { timeoutMs = 5000 } = {}) {
  if (!access_token || !refresh_token) return null;
  // supabase-js setSession can hang on iPad Safari when there's an
  // in-flight session refresh — the await never resolves, no error
  // is thrown, and the caller (account switcher) is stuck. Race it
  // against a timeout so the slow path can take over instead of
  // leaving the user staring at a frozen UI.
  const timeoutSentinel = Symbol('setSession-timeout');
  try {
    const result = await Promise.race([
      db.auth.setSession({ access_token, refresh_token }),
      new Promise((resolve) => setTimeout(() => resolve(timeoutSentinel), timeoutMs)),
    ]);
    if (result === timeoutSentinel) {
      console.warn('[auth] setSession timed out after', timeoutMs, 'ms — caller should fall back');
      return null;
    }
    const { data, error } = result;
    if (error) {
      console.warn('[auth] setSession failed:', error.message);
      return null;
    }
    const session = data?.session || (await db.auth.getSession()).data?.session;
    if (!session) return null;
    currentUser = await buildCurrentUser(session);
    notify();
    return currentUser;
  } catch (e) {
    console.warn('[auth] setSession threw:', e?.message || e);
    return null;
  }
}

export async function setDepartment(dept) {
  if (!currentUser) return;
  // dbRest + return=representation: supabase-js would report success
  // even when zero rows update (RLS or id mismatch), and our local
  // currentUser would drift from the server (mistakes.md).
  const idEsc = encodeURIComponent(currentUser.id);
  const { data, error } = await dbRest(
    `/users?id=eq.${idEsc}`,
    { method: 'PATCH', body: { department: dept || null }, prefer: 'return=representation' },
  );
  if (error) {
    console.error('[auth] setDepartment failed:', error.message);
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.error('[auth] setDepartment: no row updated (RLS or id mismatch)');
    return;
  }
  currentUser = { ...currentUser, department: dept || '' };
  notify();
}

/** Update the public-facing display name. Writes both auth.users.user_metadata
 *  (for Supabase consistency) and public.users.display_name (what the rest of
 *  the app reads). Returns the new user object. */
export async function updateDisplayName(rawName) {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const name = (rawName || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อ');
  if (name.length > 80) throw new Error('ชื่อยาวเกินไป');

  const idEsc = encodeURIComponent(currentUser.id);
  const { data, error } = await dbRest(
    `/users?id=eq.${idEsc}`,
    { method: 'PATCH', body: { display_name: name }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตชื่อไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตชื่อไม่สำเร็จ (RLS)');
  }

  // Belt-and-braces: also sync auth.users.user_metadata.display_name so a
  // fresh session picks the same value up. Ignore failures — public.users
  // is the source of truth.
  try { await db.auth.updateUser({ data: { display_name: name } }); } catch {}

  currentUser = { ...currentUser, name };
  notify();
  return currentUser;
}

/** Update the contact phone (migration 0036). Self-writable; not a
 *  privileged column so the 0028 guard lets it through. Stored digits-
 *  and-formatting as typed; validated to 9–10 digits (Thai mobile /
 *  landline) once non-digits are stripped. Pass an empty string to clear.
 *  Autofills the samoshop checkout buyer-phone on the next render. */
export async function updatePhone(rawPhone) {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const phone = (rawPhone || '').trim();
  if (phone) {
    if (phone.length > 20) throw new Error('เบอร์โทรศัพท์ยาวเกินไป');
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 10) {
      throw new Error('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง');
    }
  }

  const idEsc = encodeURIComponent(currentUser.id);
  const { data, error } = await dbRest(
    `/users?id=eq.${idEsc}`,
    { method: 'PATCH', body: { phone: phone || null }, prefer: 'return=representation' },
  );
  if (error) {
    if (error.status === 400 && /phone/i.test(error.message || '')) {
      throw new Error('ยังไม่ได้เปิดใช้ฟีเจอร์นี้ (รอ migration 0036)');
    }
    throw new Error(error.message || 'บันทึกเบอร์โทรศัพท์ไม่สำเร็จ');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกเบอร์โทรศัพท์ไม่สำเร็จ (RLS)');
  }

  currentUser = { ...currentUser, phone };
  notify();
  return currentUser;
}

/** Kick off the add/change-email flow. Supabase sends a magic-link
 *  confirmation to the new address; once the user clicks it, auth.users.email
 *  is updated and the on_auth_user_email_change trigger mirrors that into
 *  public.users.email. The username-to-email lookup RPC then resolves to the
 *  new address, so username/password sign-in keeps working. */
export async function updateEmail(rawEmail) {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email) throw new Error('กรุณากรอกอีเมล');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  }
  if (email.endsWith(`@${PASSWORD_EMAIL_DOMAIN}`)) {
    throw new Error('กรุณาใช้อีเมลจริงของคุณ');
  }
  // With Supabase's "Confirm email" toggle OFF (kept off — see
  // mistakes.md), updateUser({email}) updates auth.users.email
  // immediately and does NOT send a confirmation. The emailRedirectTo
  // option only matters when a magic link is actually sent, so we omit
  // it. The trigger from migration 0026 mirrors the new email into
  // public.users.email so the username→email lookup RPC keeps
  // password sign-in working.
  const { error } = await db.auth.updateUser({ email });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      throw new Error('อีเมลนี้มีคนใช้แล้ว');
    }
    throw new Error(error.message || 'บันทึกอีเมลไม่สำเร็จ');
  }
  // Optimistic local update — the listener will refresh from the live
  // session right after.
  currentUser = { ...currentUser, pendingEmail: email };
  notify();
}

/** Start the OAuth roundtrip to attach a Google identity to the current
 *  auth user (without creating a new account). Supabase's linkIdentity
 *  navigates to Google, then back. On return the auth user gains the
 *  google provider — onAuthStateChange refreshes currentUser. The Google
 *  account's email must match the verified email on the auth user, or
 *  Supabase refuses the link. */
export async function linkGoogleIdentity() {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const { error } = await db.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) {
    const code = error.code || error?.details?.code || '';
    const msg  = (error.message || '').toLowerCase();
    if (code === 'identity_already_exists' || msg.includes('already') || msg.includes('exists') || msg.includes('in use')) {
      throw new Error('บัญชี Google นี้ผูกกับ user คนอื่นอยู่แล้ว');
    }
    // ⚠️ TWO DIFFERENT CAUSES, and `not enabled` matches BOTH. They were one
    // branch until 2026-08-29, so on a preview — where Google is off on
    // samo-dev — this told the person to switch on "Manual linking", which is
    // a setting that is already correct and has nothing to do with it. An
    // instruction that names the wrong fix is worse than the raw error: the
    // raw one at least does not send someone to change something.
    //
    // Unlike signInWithOAuth, linkIdentity ASKS the server before navigating
    // (it GETs /user/identities/authorize with skipBrowserRedirect, then
    // assigns), so the error does reach us here — which is why this path needs
    // a better message rather than the pre-flight check signInWithGoogle uses.
    if (msg.includes('unsupported provider') || msg.includes('provider is not enabled')) {
      throw new Error('เวอร์ชันทดสอบนี้ยังไม่เปิดให้เชื่อมบัญชี Google '
        + '— ใช้ได้เฉพาะบนเว็บจริง');
    }
    if (msg.includes('manual linking')) {
      throw new Error('เปิด "Manual linking" ใน Supabase ก่อน — ดูคำสั่งใน STATE.md');
    }
    throw new Error(error.message || 'เชื่อมต่อ Google ไม่สำเร็จ');
  }
}

/** Refresh the currentUser snapshot from a fresh session. Used after any
 *  mutation (unlinkIdentity, updateUser) that changes auth.users without
 *  firing a SIGNED_IN/SIGNED_OUT event.
 *
 *  We `refreshSession()` first so the in-memory JWT picks up the updated
 *  identities/email/has_password state — getSession() alone returns the
 *  cached copy from before the mutation, which makes the modal look like
 *  the action didn't take effect. */
async function refreshCurrentUser() {
  try {
    await db.auth.refreshSession().catch(() => {});
    const { data: { session } } = await db.auth.getSession();
    currentUser = await buildCurrentUser(session);
    notify();
  } catch (e) {
    console.warn('[auth] refreshCurrentUser failed:', e);
  }
}

/** Remove the Google identity from the current auth user. Two rules
 *  Supabase enforces server-side, both pre-checked here:
 *
 *    - At least 2 identity rows must remain after the unlink — see the
 *      official docs ("The user needs to be logged in and have at
 *      least 2 linked identities to unlink an existing identity") and
 *      the server error code `single_identity_not_deletable` from
 *      GoTrueClient.
 *    - At least one of those remaining must be usable to sign in —
 *      our extra UX rule. We additionally require `hasPassword=true`
 *      so the user doesn't paint themselves into a corner.
 *
 *  Note: `db.auth.updateUser({password})` does NOT reliably create an
 *  email-provider identity row on a Google-only account, so a user can
 *  end up with `hasPassword=true` (password column set, mirrored in
 *  0027) but `identities=[google]` (length 1). In that case Supabase
 *  refuses the unlink with `single_identity_not_deletable`, and we
 *  surface a specific Thai message that points at the cause. */
export async function unlinkGoogleIdentity() {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  if (!currentUser.hasGoogle) throw new Error('ยังไม่ได้เชื่อม Google');
  if (!currentUser.hasPassword) {
    throw new Error('ตั้ง username + รหัสผ่านก่อน เพื่อไม่ให้บัญชีนี้เข้าระบบไม่ได้หลังยกเลิกการเชื่อม');
  }
  const list = Array.isArray(currentUser.identities) ? currentUser.identities : [];
  if (list.length < 2) {
    throw new Error(
      'Supabase ต้องการ identity อย่างน้อย 2 รายการเพื่อยกเลิก — ' +
      'ตอนนี้บัญชีนี้มี identity เดียว แม้จะตั้งรหัสผ่านแล้วก็ตาม',
    );
  }
  const googleIdentity = list.find((id) => id?.provider === 'google');
  if (!googleIdentity) throw new Error('ไม่พบ identity Google');
  const { error } = await db.auth.unlinkIdentity(googleIdentity);
  if (error) {
    // Use server error codes when available — they're stable. Fall
    // back to message-matching for older auth-js.
    const code  = error.code || error?.details?.code || '';
    const msg   = (error.message || '').toLowerCase();
    if (code === 'single_identity_not_deletable' || msg.includes('single')) {
      throw new Error('Supabase ปฏิเสธเพราะเหลือ identity เดียว — ลองตั้งรหัสผ่านอีกครั้งหรือเชื่อมผู้ให้บริการอื่น');
    }
    // ⚠️ TWO DIFFERENT CAUSES, and `not enabled` matches BOTH. They were one
    // branch until 2026-08-29, so on a preview — where Google is off on
    // samo-dev — this told the person to switch on "Manual linking", which is
    // a setting that is already correct and has nothing to do with it. An
    // instruction that names the wrong fix is worse than the raw error: the
    // raw one at least does not send someone to change something.
    //
    // Unlike signInWithOAuth, linkIdentity ASKS the server before navigating
    // (it GETs /user/identities/authorize with skipBrowserRedirect, then
    // assigns), so the error does reach us here — which is why this path needs
    // a better message rather than the pre-flight check signInWithGoogle uses.
    if (msg.includes('unsupported provider') || msg.includes('provider is not enabled')) {
      throw new Error('เวอร์ชันทดสอบนี้ยังไม่เปิดให้เชื่อมบัญชี Google '
        + '— ใช้ได้เฉพาะบนเว็บจริง');
    }
    if (msg.includes('manual linking')) {
      throw new Error('เปิด "Manual linking" ใน Supabase ก่อน — ดูคำสั่งใน STATE.md');
    }
    throw new Error(error.message || 'ยกเลิกการเชื่อม Google ไม่สำเร็จ');
  }
  await refreshCurrentUser();
}

/** Revert the user's auth email to the synthetic <username>@samomdkku.app,
 *  effectively "removing" the real email from the account. Requires both
 *  a username and a password identity (otherwise we'd lose every way to
 *  sign in). Synthetic emails don't deliver — see mistakes.md "Email
 *  confirmation must be OFF in Supabase for synthetic emails" — so this
 *  is safe to call without burning the SMTP rate limit. */
export async function unlinkEmail() {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  if (!currentUser.username) {
    throw new Error('ต้องมี username เพื่อย้อนกลับเป็นอีเมลสังเคราะห์');
  }
  if (!currentUser.hasPassword) {
    throw new Error('ตั้งรหัสผ่านก่อน เพื่อไม่ให้บัญชีเข้าระบบไม่ได้หลังลบอีเมล');
  }
  if (!currentUser.email) {
    // Already on synthetic — nothing to do, success.
    return;
  }
  const synth = usernameToEmail(currentUser.username);
  const { error } = await db.auth.updateUser({ email: synth });
  if (error) throw new Error(error.message || 'ลบอีเมลไม่สำเร็จ');
  await refreshCurrentUser();
}

/** Set username + password on a Google-only account (or for someone who
 *  signed up without a password somehow). After this the user can sign
 *  in via username/password too. Username must be globally unique on
 *  public.users.username; we pre-check via the lookup_email_by_username
 *  RPC (returns non-null when taken) before any mutation. */
export async function setUsernameAndPassword(rawUsername, rawPassword) {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const username = (rawUsername || '').trim().toLowerCase();
  const password = (rawPassword || '').trim();
  if (!username || !password) throw new Error('กรุณากรอก Username และ Password');
  if (username.length < 3) throw new Error('Username ต้องมีอย่างน้อย 3 ตัวอักษร');
  if (password.length < 6) throw new Error('Password ต้องมีอย่างน้อย 6 ตัวอักษร');
  if (!/^[a-z0-9_.-]+$/i.test(username)) {
    throw new Error('Username ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ -');
  }
  // Reserve the staff-prefix namespace from grabs by Google users.
  if (/^samomdkku/.test(username) || username === 'sastaff' || username === 'saprof') {
    throw new Error('Username นี้สงวนไว้สำหรับเจ้าหน้าที่');
  }

  // If user already has a username, they're not allowed to change it
  // here — username is sticky once set. Use the password-only path.
  const settingUsername = !currentUser.username;
  if (settingUsername) {
    // Uniqueness pre-check. lookup_email_by_username returns the matching
    // user's email; non-null means the username is already taken.
    try {
      const { data, error } = await dbRest('/rpc/lookup_email_by_username', {
        method: 'POST',
        body: { p_username: username },
      });
      if (!error && typeof data === 'string' && data.includes('@')) {
        throw new Error('Username นี้มีผู้ใช้งานแล้ว');
      }
    } catch (e) {
      if (/มีผู้ใช้งาน/.test(e.message || '')) throw e;
      // RPC missing (pre-0026) — fall through to the unique-constraint
      // collision at write time.
    }

    const idEsc = encodeURIComponent(currentUser.id);
    const { data, error } = await dbRest(
      `/users?id=eq.${idEsc}`,
      { method: 'PATCH', body: { username }, prefer: 'return=representation' },
    );
    if (error) {
      // Unique-constraint violation = the username was taken between
      // pre-check and write (or RPC was unavailable). Surface as a
      // friendly Thai error.
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('unique') || msg.includes('duplicate')) {
        throw new Error('Username นี้มีผู้ใช้งานแล้ว');
      }
      throw new Error(error.message || 'ตั้ง username ไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('ตั้ง username ไม่สำเร็จ (RLS)');
    }
  }

  // updateUser({password}) sets the password on the current user.
  // For users whose auth identity was originally OAuth-only, Supabase
  // attaches the password to auth.users.encrypted_password; subsequent
  // signInWithPassword({email: <their auth email>, password}) works.
  const { error: pwdErr } = await db.auth.updateUser({ password });
  if (pwdErr) throw new Error(pwdErr.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
  await refreshCurrentUser();
}

/** Change password for a user who already has one. Plain wrapper around
 *  updateUser({password}) — we already trust the session as proof of
 *  identity, so no "current password" challenge is required (this is the
 *  Supabase / Google / Apple Account default). */
export async function changePassword(rawPassword) {
  if (!currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
  const password = (rawPassword || '').trim();
  if (password.length < 6) throw new Error('Password ต้องมีอย่างน้อย 6 ตัวอักษร');
  const { error } = await db.auth.updateUser({ password });
  if (error) throw new Error(error.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
  await refreshCurrentUser();
}

/**
 * Subscribe to auth changes. The callback is invoked immediately with the
 * current state, then again on every sign-in / sign-out / profile update.
 * Returns an unsubscribe function.
 */
export function onAuthChange(cb) {
  subscribers.add(cb);
  try { cb(currentUser); } catch (e) { console.error('auth subscriber error', e); }
  return () => subscribers.delete(cb);
}
