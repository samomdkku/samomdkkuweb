#!/usr/bin/env node
// ============================================================
// security0236-login-flow-probe.mjs — the username→email leak, BOTH
// directions, over the REAL anon key and the REAL PostgREST endpoint. No
// Chrome in this sandbox (same gap task 14 already documented), so this is
// the closest substitute to "a real browser sign-in" available here: an
// actual HTTPS call to the exact RPC src/js/auth.js's signInWithPassword
// calls, with the real bundled-shape anon key — not a role-switched SQL
// probe (that version is tools/security0236-username-lookup-hardening.sql).
//
// NOT COVERED HERE: the follow-on GoTrue `grant_type=password` call itself.
// A hand-inserted auth.users + auth.identities row (this script creates one
// of each, matching every documented required column) 500s on samo-dev with
// "Database error querying schema" — reproduced, and NOT a regression this
// migration caused: the same call against a real, nonexistent email returns
// the expected 400 `invalid_credentials`, so password-grant sign-in works on
// this project; something about a hand-crafted row trips GoTrue internally
// (most likely a column this schema snapshot doesn't expose through
// information_schema, e.g. an MFA/session invariant `signUp()` populates
// that a raw INSERT does not). Out of scope to chase further here — the
// property this file exists to prove is the RPC's OWN answer, which every
// case below exercises directly over the network GoTrue sits behind, same
// endpoint, same anon key. The owner can confirm the full round-trip once
// this branch is live by registering + signing in through the real UI.
//
// SAMO-DEV ONLY — refuses anything else. It writes two throwaway accounts,
// never prints an email beyond this file's own probe.invalid sentinels, and
// deletes both in a `finally`.
//
//   node tools/security0236-login-flow-probe.mjs
// ============================================================
import { loadEnv, resolveTarget, runSql } from './env-lib.mjs';

const loaded = loadEnv();
const target = resolveTarget({
  ...loaded,
  env: { ...loaded.env, VITE_SUPABASE_URL: loaded.fileEnv.SUPABASE_DEV_URL, SUPABASE_ACCESS_TOKEN: loaded.fileEnv.SUPABASE_DEV_ACCESS_TOKEN },
});
const ANON = loaded.fileEnv.SUPABASE_DEV_ANON_KEY;
if (!target.isDev || !target.token || !ANON) {
  console.error(`refusing: database target is "${target.label}" — this probe creates real accounts and only ever runs on samo-dev`);
  process.exit(1);
}
const URL_BASE = loaded.fileEnv.SUPABASE_DEV_URL.replace(/\/$/, '');
console.error(`→ database: ${target.ref} (${target.label}) · rest: ${URL_BASE}`);

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log('  PASS', name); }
  else { fail += 1; console.log('  FAIL', name, '->', String(extra).slice(0, 200)); }
};

async function rpc(path, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

const rand = () => Math.random().toString(36).slice(2, 10);
const nativeUsername = `security0236n${rand()}`;
const nativeEmail = `${nativeUsername}@samomdkku.app`;
const nativePassword = `Native-${rand()}-Aa1`;
const realUsername = `security0236g${rand()}`;
const realEmail = `security0236-real-${rand()}@probe.invalid`; // stands in for a real personal address
const realPassword = `Real-${rand()}-Aa1`;
const wrongPassword = `wrong-${rand()}`;
const nativeId = '00000000-0000-4000-8000-00000002360a';
const googleId = '00000000-0000-4000-8000-00000002360b';

const sql = (q) => runSql(q, target);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

(async () => {
  console.log(`username-lookup login-flow probe -> ${URL_BASE}\n`);

  await sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values
    (${lit(nativeId)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      ${lit(nativeEmail)}, extensions.crypt(${lit(nativePassword)}, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', ${lit(nativeUsername)}, 'method', 'password'), '', '', '', ''),
    (${lit(googleId)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      ${lit(realEmail)}, extensions.crypt(${lit(realPassword)}, extensions.gen_salt('bf')),
      now(), '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb, '', '', '', '');
    update public.users set username = ${lit(realUsername)} where id = ${lit(googleId)};
    insert into auth.identities (provider_id, user_id, identity_data, provider, id)
    values
    (${lit(nativeId)}, ${lit(nativeId)}, jsonb_build_object('sub', ${lit(nativeId)}, 'email', ${lit(nativeEmail)}), 'email', gen_random_uuid()),
    (${lit(googleId)}, ${lit(googleId)}, jsonb_build_object('sub', ${lit(googleId)}, 'email', ${lit(realEmail)}), 'email', gen_random_uuid());
  `);

  try {
    // §A — the native/synthetic account: the RPC's answer here is a
    // NO-OP (derivable from the username alone), so it is returned
    // regardless of whether a password was supplied at all.
    let r = await rpc('lookup_email_by_username', { p_username: nativeUsername });
    check('A1. native account, no password -> synthetic email (unchanged behaviour)',
      r.json === nativeEmail, JSON.stringify(r));
    r = await rpc('lookup_email_by_username', { p_username: nativeUsername, p_password: wrongPassword });
    check('A2. native account, WRONG password -> still the synthetic email (no regression)',
      r.json === nativeEmail, JSON.stringify(r));

    // §B — the real-email account: THIS is the leak this migration closes.
    r = await rpc('lookup_email_by_username', { p_username: realUsername });
    check('B1. DENY — real-email account, no password -> null (closed)', r.json === null, JSON.stringify(r));
    r = await rpc('lookup_email_by_username', { p_username: realUsername, p_password: wrongPassword });
    check('B2. DENY — real-email account, WRONG password -> null, same as B1 (no oracle)', r.json === null, JSON.stringify(r));
    r = await rpc('lookup_email_by_username', { p_username: realUsername, p_password: realPassword });
    check('B3. ALLOW — real-email account, CORRECT password -> the real email (sign-in still works)',
      r.json === realEmail, JSON.stringify(r));

    // §C — unknown username: no oracle for existence either.
    r = await rpc('lookup_email_by_username', { p_username: `nope-${rand()}` });
    check('C1. unknown username -> null', r.json === null, JSON.stringify(r));
  } finally {
    await sql(`delete from auth.users where id in (${lit(nativeId)}, ${lit(googleId)});`);
    const leftover = JSON.parse(await sql(
      `select count(*)::int as n from auth.users where id in (${lit(nativeId)}, ${lit(googleId)});`,
    ));
    check('cleanup: both throwaway accounts removed', leftover[0].n === 0, JSON.stringify(leftover));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
