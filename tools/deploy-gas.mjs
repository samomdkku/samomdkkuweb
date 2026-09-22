#!/usr/bin/env node
// ============================================================
// deploy-gas.mjs — push appscript/prform.gs to the live Apps Script project and
// roll the EXISTING web-app deployment onto a new version.
//
// Replaces the copy-paste procedure in skills/deploy-gas.md, which had two ways
// to go wrong that nobody notices until a user hits the broken path: forgetting
// the "New version" step (the editor shows your code, the /exec URL still runs
// the old one), and clobbering an edit somebody made in the GAS editor.
//
// ── THE THING THIS MUST NEVER DO ────────────────────────────────────────────
// `clasp deploy` (create-deployment) mints a NEW deployment with a NEW /exec
// URL. GAS_API_URL in src/js/config.js is hard-coded to the existing one, so a
// new deployment reads as "every upload silently 404s". We always
// create-version + update-deployment against the SAME deployment id.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// Pulls the remote first and diffs it against the repo. If someone edited the
// script in the browser, that shows up here and the deploy stops unless you pass
// --force. Pushing is otherwise a silent overwrite of work you cannot recover.
//
// Pushes from a STAGING directory rather than appscript/, so:
//   * the remote manifest (appsscript.json — oauth scopes, webapp access,
//     timezone) is round-tripped from the remote instead of authored blind. A
//     wrong manifest can change "who has access" or force every user to
//     re-authorize.
//   * the remote file KEEPS ITS NAME. If the project's code lives in `Code.gs`,
//     pushing `prform.gs` would delete Code.gs and create prform.gs — harmless
//     in effect, noisy in the revision history, and confusing next time someone
//     opens the editor.
//
// ── SETUP (one-time, yours — these are credentials) ─────────────────────────
//   1. npx clasp login
//        Opens a browser. Writes ~/.clasprc.json. NEVER commit that file.
//   2. Enable the Apps Script API for the same Google account:
//        https://script.google.com/home/usersettings  → "Apps Script API: ON"
//        (clasp fails with "User has not enabled the Apps Script API" without it.)
//   3. Put the script id in .env.local (gitignored):
//        GAS_SCRIPT_ID=<from the GAS project's Project Settings → IDs>
//      Optional, skips a lookup and removes all ambiguity:
//        GAS_DEPLOYMENT_ID=<from Deploy → Manage deployments, in the URL>
//
// ── RUN ─────────────────────────────────────────────────────────────────────
//   npm run deploy:gas                 # diff, push, version, redeploy, verify
//   npm run deploy:gas -- --dry-run    # diff + report only, no writes
//   npm run deploy:gas -- --force      # proceed even if the remote has drifted
//   npm run deploy:gas -- --verify     # only probe the live endpoint
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'appscript', 'prform.gs');
const STAGE = join(ROOT, '.gas-build');
const PULLED = join(ROOT, '.gas-remote');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DRY = has('--dry-run');
const FORCE = has('--force');
const VERIFY_ONLY = has('--verify');

// ---- tiny .env.local parser (same shape as apply-migration.mjs) ----
function env() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
}
const ENV = env();
// A real environment wins over .env.local — lets a one-off
// `GAS_SCRIPT_ID=… GAS_DEPLOYMENT_ID=… npm run deploy:gas` target a DIFFERENT
// project (e.g. patching the retired one during a migration overlap) without
// editing the dotfile. Allow-listed rather than spread, so unrelated shell vars
// cannot leak in. The passport port of this tool has the same block.
for (const k of ['GAS_SCRIPT_ID', 'GAS_DEPLOYMENT_ID']) {
  if (process.env[k]) ENV[k] = process.env[k];
}

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/** Run clasp in `cwd`. Returns stdout; throws with stderr attached on failure. */
function clasp(args, cwd, { quiet = false } = {}) {
  try {
    const out = execFileSync('npx', ['clasp', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!quiet) process.stdout.write(out);
    return out;
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim();
    const err = new Error(detail || e.message);
    err.detail = detail;
    throw err;
  }
}

function writeClaspJson(dir, scriptId) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.clasp.json'),
    `${JSON.stringify({ scriptId, rootDir: '.' }, null, 2)}\n`);
}

// ---- the live endpoint probe -----------------------------------------------
//
// `uploadTeamFile` with no folderPath is the ideal canary: the handler validates
// the argument BEFORE touching Drive, so it proves the action exists while
// writing nothing.
//   new code -> {"success":false,"message":"folderPath is required"}
//   old code -> {"success":false,"message":"Unknown action: uploadTeamFile"}
/**
 * The `/exec` URL the app actually calls, straight out of src/js/config.js.
 *
 * Its path segment IS the deployment id — which makes config.js the single
 * source of truth for BOTH "which endpoint do we verify" and "which deployment
 * do we roll". This project has three deployments (one @HEAD, the live one, and
 * an old stable @25 kept for rollback), so "pick the only non-HEAD one" is not
 * good enough; rolling the wrong one would look like the deploy silently did
 * nothing, because /exec would still serve the old version.
 */
function liveEndpoint() {
  // An explicit override means we are deploying an endpoint config.js does not
  // reference; verify THAT one, or the probe silently green-lights a different
  // deployment than the one just rolled.
  if (ENV.GAS_DEPLOYMENT_ID) {
    return {
      url: `https://script.google.com/macros/s/${ENV.GAS_DEPLOYMENT_ID}/exec`,
      deploymentId: ENV.GAS_DEPLOYMENT_ID,
    };
  }
  const cfg = readFileSync(join(ROOT, 'src', 'js', 'config.js'), 'utf8');
  const m = cfg.match(/https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
  return m ? { url: m[0], deploymentId: m[1] } : null;
}

async function probeLive() {
  const ep = liveEndpoint();
  if (!ep) return { ok: false, reason: 'could not find GAS_API_URL in src/js/config.js' };
  const { url } = ep;
  // Google intermittently answers /exec with an HTML "busy" page instead of
  // running the script (src/js/gas-post.js). One such page is not an answer
  // about the code — measured 2026-09-22: 2 HTML pages, then the real JSON.
  // Retry it, as the app does; report "unrecognised" only if it persists.
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'uploadTeamFile' }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await r.text();
      if (/folderPath is required/.test(body)) return { ok: true, url, body };
      if (/Unknown action/.test(body)) return { ok: false, url, body, stale: true };
      last = { ok: false, url, body: body.slice(0, 200), reason: `unrecognised response (${attempt} tries — Google's busy page?)` };
    } catch (e) {
      last = { ok: false, url, reason: String(e.message || e) };
    }
    await new Promise((res) => setTimeout(res, 2500 * attempt));
  }
  return last;
}

async function main() {
  if (VERIFY_ONLY) {
    const v = await probeLive();
    console.log(v.ok
      ? `✓ live endpoint runs the NEW code\n  ${v.url}\n  ${v.body}`
      : `✗ ${v.stale ? 'live endpoint still runs the OLD code' : 'probe failed'}\n  ${v.body || v.reason}`);
    process.exit(v.ok ? 0 : 1);
  }

  const scriptId = ENV.GAS_SCRIPT_ID;
  if (!scriptId) {
    die('GAS_SCRIPT_ID is not set in .env.local',
      'Get it from the Apps Script project → ⚙ Project Settings → IDs → Script ID,\n'
      + 'then add to .env.local (gitignored):\n\n  GAS_SCRIPT_ID=1AbC...\n');
  }
  if (!existsSync(SRC)) die(`missing ${SRC}`);

  // ---- auth preflight, so failures name the fix instead of dumping a stack ---
  try {
    clasp(['show-authorized-user'], ROOT, { quiet: true });
  } catch (e) {
    die('clasp is not logged in',
      `Run:  npx clasp login\n\nThen enable the Apps Script API for the SAME account:\n`
      + `  https://script.google.com/home/usersettings\n\n(${String(e.detail || e.message).slice(0, 200)})`);
  }
  console.log(`→ script: ${scriptId}`);

  // ---- 1. pull the remote and diff -----------------------------------------
  rmSync(PULLED, { recursive: true, force: true });
  writeClaspJson(PULLED, scriptId);
  try {
    clasp(['pull'], PULLED, { quiet: true });
  } catch (e) {
    const d = String(e.detail || e.message);
    if (/Apps Script API/i.test(d)) {
      die('the Apps Script API is not enabled for this account',
        'Turn it on (one toggle, takes effect immediately):\n'
        + '  https://script.google.com/home/usersettings');
    }
    die(`clasp pull failed:\n${d.slice(0, 600)}`);
  }

  const remoteFiles = readdirSync(PULLED).filter((f) => f !== '.clasp.json');
  const remoteCode = remoteFiles.filter((f) => /\.(gs|js)$/.test(f));
  if (remoteCode.length !== 1) {
    die(`expected exactly one code file in the remote project, found: ${remoteCode.join(', ') || '(none)'}`,
      'This tool assumes the slim single-file project described in skills/deploy-gas.md.\n'
      + 'Reconcile the project by hand before automating it.');
  }
  const mainName = remoteCode[0];
  const remoteSrc = readFileSync(join(PULLED, mainName), 'utf8');
  const localSrc = readFileSync(SRC, 'utf8');

  const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
  const drifted = norm(remoteSrc) !== norm(localSrc);
  console.log(`→ remote file: ${mainName} (${remoteSrc.length} bytes)`);
  console.log(`→ local  file: appscript/prform.gs (${localSrc.length} bytes)`);

  if (!drifted) {
    console.log('→ remote code already matches the repo (only the deployment may be stale)');
  } else {
    // Only the remote-only lines matter: local-only lines are what we are about
    // to push, and reporting both drowns the signal.
    const localLines = new Set(norm(localSrc).split('\n'));
    const remoteLines = new Set(norm(remoteSrc).split('\n'));
    const onlyRemote = norm(remoteSrc).split('\n')
      .filter((l) => l.trim() && !localLines.has(l));
    const onlyLocal = norm(localSrc).split('\n')
      .filter((l) => l.trim() && !remoteLines.has(l));

    if (!onlyRemote.length) {
      // The repo is a strict superset — this is the ordinary "we added things"
      // case and must not be dressed up as a warning, or the real one stops
      // being noticed.
      console.log(`→ repo is AHEAD of the remote by ${onlyLocal.length} line(s); nothing on the remote would be lost`);
    } else {
      console.log(`\n⚠ the remote has ${onlyRemote.length} line(s) the repo does NOT — someone edited it in the browser:`);
      onlyRemote.slice(0, 25).forEach((l) => console.log(`    ${l.slice(0, 120)}`));
      if (onlyRemote.length > 25) console.log(`    … and ${onlyRemote.length - 25} more`);
      console.log(`\n  A copy of the remote is in .gas-remote/ — diff it properly with:`);
      console.log(`    diff .gas-remote/${mainName} appscript/prform.gs\n`);
      if (!FORCE && !DRY) {
        die('refusing to overwrite remote-only changes',
          'If those lines are stale, re-run with --force.\n'
          + 'If they are real, copy them into appscript/prform.gs first.');
      }
    }
  }

  if (DRY) {
    console.log('\n(--dry-run) stopping before any write.');
    const v = await probeLive();
    console.log(v.ok ? '  live endpoint: NEW code' : `  live endpoint: ${v.stale ? 'OLD code' : v.reason}`);
    return;
  }

  // ---- 2. stage ------------------------------------------------------------
  // The manifest is round-tripped from the remote so we never invent oauthScopes
  // or webapp access settings we cannot see.
  rmSync(STAGE, { recursive: true, force: true });
  writeClaspJson(STAGE, scriptId);
  const manifestPath = join(PULLED, 'appsscript.json');
  if (!existsSync(manifestPath)) {
    die('the remote project has no appsscript.json',
      'Refusing to synthesise one — it controls oauth scopes and web-app access.');
  }
  writeFileSync(join(STAGE, 'appsscript.json'), readFileSync(manifestPath, 'utf8'));
  writeFileSync(join(STAGE, mainName), localSrc);

  // ---- 3. push -------------------------------------------------------------
  console.log('\n→ pushing…');
  clasp(['push', '-f'], STAGE);

  // ---- 4. new immutable version -------------------------------------------
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const desc = `repo deploy ${stamp}`;
  console.log('\n→ creating version…');
  const versionOut = clasp(['create-version', desc], STAGE);
  const vm = versionOut.match(/(\d+)/);
  if (!vm) die(`could not read the new version number from clasp output:\n${versionOut}`);
  const version = vm[1];
  console.log(`→ version ${version}`);

  // ---- 5. roll the EXISTING deployment ------------------------------------
  // Derived from GAS_API_URL, not guessed from the deployment list: the id in
  // that URL is BY DEFINITION the deployment the app talks to. An env override
  // stays available for the odd case of deploying an endpoint config.js does not
  // reference.
  const deploymentId = ENV.GAS_DEPLOYMENT_ID || liveEndpoint()?.deploymentId;
  if (!deploymentId) {
    die('could not determine which deployment to update',
      'src/js/config.js has no recognisable GAS_API_URL. Set it explicitly:\n\n'
      + '  GAS_DEPLOYMENT_ID=AKfycb...    (in .env.local)\n');
  }
  // Sanity-check it actually exists on this script, so a config.js/script-id
  // mismatch fails here with a clear message rather than inside clasp.
  const list = clasp(['list-deployments'], STAGE, { quiet: true });
  if (!list.includes(deploymentId)) {
    die(`deployment ${deploymentId} does not belong to script ${scriptId}`,
      `GAS_API_URL in src/js/config.js points at a deployment this script does not\n`
      + `have. Either GAS_SCRIPT_ID is the wrong project, or config.js is stale.\n\n`
      + `clasp list-deployments said:\n${list}`);
  }
  console.log(`\n→ updating deployment ${deploymentId} → version ${version}`);
  clasp(['update-deployment', deploymentId, '-V', version, '-d', desc], STAGE);

  // ---- 6. prove it ---------------------------------------------------------
  // GAS can take a moment to swap the served version; a single immediate probe
  // produces a false "still old".
  console.log('\n→ verifying the live endpoint…');
  let v = null;
  for (let i = 0; i < 5; i++) {
    v = await probeLive();
    if (v.ok) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!v?.ok) {
    die(`deployed, but the live endpoint does not report the new code:\n  ${v?.body || v?.reason}`,
      'Check Deploy → Manage deployments in the editor: the web-app deployment\n'
      + `should now point at version ${version}.`);
  }
  console.log(`✓ live: ${v.body}`);
  console.log(`✓ ${v.url}`);
  console.log('\nDone. The /exec URL is unchanged.');
}

main().catch((e) => { console.error(e); process.exit(1); });
