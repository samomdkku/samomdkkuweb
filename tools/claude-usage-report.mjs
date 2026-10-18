#!/usr/bin/env node
// ============================================================
// claude-usage-report.mjs — post MEASURED Claude usage into the board.
//
// WHY THIS IS A SCRIPT AND NOT A FEATURE OF THE WEB APP
// The numbers on /admin#claude are what people DECLARED they would use. Nobody
// knows in advance that they will use 30%, so without a measured counterpart
// the board drifts from reality within a week and stops being believed.
//
// The measurement exists, and is confirmed working against the live account:
//     GET https://api.anthropic.com/api/oauth/usage
//     Authorization: Bearer <token>
//     anthropic-beta: oauth-2025-04-20
//   → {"five_hour":{"utilization":51.0,"resets_at":"…"},
//      "seven_day":{"utilization":34.0,"resets_at":"2026-08-19T09:00:00Z"}, …}
// VALIDATED AGAINST /usage (2026-08-16). Claude Code's own TUI and this
// endpoint were read minutes apart and agree exactly:
//        /usage TUI                     oauth/usage API
//   session  77% · resets 4:30am ICT    75% · 21:29:59Z = 4:30am ICT
//   week     36% · resets Aug 19 4pm    36% · 08:59:59Z = Aug 19 4pm
// and claude_week_start() independently computes 09:00:00Z for that same
// boundary. Three sources, one answer. So this is not an approximation of what
// /usage shows — it IS what /usage shows, in JSON.
//
// WHY NOT DRIVE /usage INSTEAD (it is free, it consumes no session tokens):
// because it only exists inside the interactive TUI, so reading it means
// attaching a pseudo-terminal, typing the command and screen-scraping the
// rendered frame. Same numbers, via a terminal emulator, from a Claude Code
// process that has to be installed and logged in. The endpoint gives the same
// data as JSON with one fetch.
//
// AND WHY NOT A LOCAL-LOG TOOL (ccusage, phuryn/claude-usage, and the local
// mode of Maciek-roboblog/Claude-Code-Usage-Monitor): /usage itself states the
// ceiling — "Approximate, based on local sessions on this machine — does not
// include other devices or claude.ai". SAMO's members use one shared account
// from their own laptops, so no single machine's logs can see the account. Only
// this endpoint is account-wide, which is the entire reason it can run on a VM
// where nobody codes.
//
// YOU LOG IN ONCE. Not every 2 hours, not every 12 days.
//
// The token is a USER credential, not an API key:
//   • the ACCESS token lives ~2 hours
//   • the REFRESH token lives ~12 days and ROTATES on every use — each refresh
//     returns a new one with a fresh window
// so this script owns the refresh: it reads the stored credentials, refreshes
// when they are near expiry, and writes the rotated pair back where it found
// them. Running every 15 minutes renews that 12-day window ~96 times a day, so
// it never approaches expiry. A re-login is needed only if the timer has been
// dead for ~12 consecutive days.
//
// The write-back is not optional. Dropping the rotated pair burns the refresh
// token and strands the account at the next run.
//
// AND NO, AN API KEY CANNOT DO THIS. An `sk-ant-…` key authenticates the pay-
// per-token API, which has no 5-hour session window and no weekly cap at all —
// it is metered by RPM/ITPM/OTPM against a bill. The 5-hour and 7-day windows
// this board books against exist only on the *subscription*, and the only
// credential that can read them is the subscription login. The Admin API
// (`sk-ant-admin-…`) reports API-organisation cost, not subscription limits,
// and needs a Team/Enterprise org. Neither substitutes for the OAuth token.
//
// WHERE THE CREDENTIALS LIVE (this differs by OS, and getting it wrong is why
// the first version of this script found nothing on a Mac):
//   macOS  → Keychain, service "Claude Code-credentials"  (NO file exists)
//   Linux  → ~/.claude/.credentials.json
//
// RUN IT ON THE MACHINE THAT HOLDS THE SAMO CLAUDE LOGIN. For SAMO that is the
// KKU VM, so it keeps reporting when nobody's laptop is open.
//
// USE `claude login`, NOT `claude setup-token`. MEASURED 2026-08-16:
//
//   setup-token  → oauth/usage HTTP 403
//                  {"type":"permission_error","message":"OAuth token does not
//                   meet scope requirement user:profile"}
//   claude login → oauth/usage HTTP 200
//
// `claude setup-token` advertises a one-year token and looks like the obvious
// answer to "I don't want to keep logging in" — it was recommended here for
// exactly that reason and it was WRONG. The token it mints carries
// `user:inference` but not `user:profile`, so it can spend the subscription and
// cannot read it. Precisely backwards for a monitor.
//
// So: run `claude login` on the machine that will report (for SAMO, the VM).
// It writes ~/.claude/.credentials.json with the full scope set, and this
// script owns the refresh cycle from there — see below. One login, then never
// again while the timer keeps running.
//
// ENV (.env.local on a dev box, /etc/samo-claude-usage.env on the VM):
//     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//     CLAUDE_REPORTER_EMAIL     an account that HOLDS the `claude` permission
//     CLAUDE_REPORTER_PASSWORD  its password
//
// It signs in as an ordinary account and inserts under RLS — deliberately NOT
// service_role. A reporter that bypassed RLS would be a second, invisible write
// path into a table the app also writes, and this repo's rule is that the gate
// lives on the table.
//
// POLL EVERY 15 MINUTES, NOT IN A LOOP. The usage endpoint rate-limits hard.
// 15 min is well inside what it tolerates and is what the systemd timer does;
// a 429 is handled as a normal skipped tick, never as an incident.
//
// THE OFF SWITCH LIVES IN THE DATABASE, AND IS READ FIRST (migration 0167).
// Before this run touches Anthropic it signs in to Supabase and asks
// `claude_monitoring_enabled()`. Switched off, it logs one line and exits 0:
// no usage call, no token refresh, no Discord alert. The whole point is that a
// pause costs Anthropic ZERO requests.
//
// Why the switch is not just `systemctl disable`, which is what it replaced:
// that needs ssh through the VPN, so no admin without a shell can do it; it is
// invisible to the app, so the board goes on showing the last sample as though
// it were live; and it carries no reason, so the ~150 people who can book have
// no way to learn that the subscription lapsed rather than the site breaking.
// The switch is flipped at /admin#claude, requires a reason, and announces
// itself in the same Discord channel the bookings use.
//
// A PAUSE LONGER THAN ~12 DAYS COSTS ONE `claude login`. The refresh token
// rotates on use and expires after about twelve days, and a paused reporter
// deliberately does not refresh it — refreshing would mean calling Anthropic
// every couple of hours while claiming to be switched off, and when the
// SUBSCRIPTION is what lapsed the refresh fails and alerts exactly as before.
// So: a short pause resumes by itself, a long one needs one ssh. That trade is
// stated on the board and in the Discord notice, not hidden here.
//
// WHAT THIS DOES NOT DO, and cannot: attribute usage to a PERSON. The endpoint
// reports the whole subscription — "how close is the account to its cap" — and
// says nothing about who spent it. That breakdown lives in each person's own
// ~/.claude session logs, on their own laptop, which is what ccusage reads.
// Nothing on the VM can see those, because nobody runs Claude on the VM. If
// per-person truth is ever wanted, the shape is a small reporter each member
// runs, not a change here.
//
// FAILURE POSTURE: everything degrades to "no sample". The board renders a
// plain ledger and hides the measured strip rather than showing a zero — a zero
// reads as a reading. So every error path writes nothing.
//
// AND THE SWITCH READ FAILS CLOSED. If the question "am I switched on?" cannot
// be answered — network, HTTP 500, a revoked grant returning zero rows rather
// than an error — the answer is treated as NO. Polling on an unanswered
// question is the fail-open shape this repo keeps paying for, and here it would
// restore the exact behaviour the switch exists to stop.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
// Claude Code's own public OAuth client. Overridable because a client id is a
// deployment detail, not a law of nature.
const TOKEN_URL = process.env.CLAUDE_OAUTH_TOKEN_URL
  || 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID
  || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const REFRESH_MARGIN_MS = 10 * 60 * 1000;   // refresh when <10 min of life left

function loadEnv() {
  const out = { ...process.env };
  const f = new URL('../.env.local', import.meta.url);
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (out[m[1]] === undefined) out[m[1]] = v;
  }
  return out;
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/**
 * Tell a human, in Discord, that the reporter needs a re-login.
 *
 * A monitor that fails silently is worse than no monitor: the board would go on
 * showing the last sample, quietly ageing, and the first sign of trouble would
 * be someone noticing weeks later that the number looked wrong. The one failure
 * that needs a person is the refresh token expiring, and the fix (`claude
 * login` on the VM) is something only a person can do.
 *
 * THROTTLED to once per 6 hours via a stamp file: the timer runs every 15
 * minutes, so an un-throttled alert would post ~96 times a day and be muted
 * within the hour — which is the same as not alerting at all.
 */
async function alertHuman(env, reason, detail) {
  const stamp = join(tmpdir(), 'samo-claude-usage-alert.stamp');
  try {
    if (existsSync(stamp)
        && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 60 * 60 * 1000) {
      return;
    }
  } catch { /* unreadable stamp → alert anyway, better twice than never */ }

  const url = env.NOTIFY_URL || 'http://127.0.0.1:8787/notify';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'notifyClaudeAlert', reason, detail }),
    });
    writeFileSync(stamp, String(Date.now()));
  } catch (e) {
    console.error(`  (could not reach ${url} to raise an alert: ${e.message})`);
  }
}

/** die(), but tell Discord first — for the failures a person must fix. */
async function dieLoudly(env, reason, detail) {
  await alertHuman(env, reason, detail);
  die(`${reason} — ${detail}`);
}

// ---------- credential store (two backends, one shape) ----------

function credFilePath(env) {
  return env.CLAUDE_CREDENTIALS_PATH
    || join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json');
}

/** Read the stored credentials. Returns { store, data, path } or null. */
function loadCreds(env) {
  const path = credFilePath(env);
  if (existsSync(path)) {
    try {
      return { store: 'file', path, data: JSON.parse(readFileSync(path, 'utf8')) };
    } catch (e) {
      die(`${path} is not valid JSON (${e.message})`);
    }
  }
  if (platform() === 'darwin') {
    try {
      const raw = execFileSync(
        'security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (raw) return { store: 'keychain', path: null, data: JSON.parse(raw) };
    } catch { /* not in the Keychain either */ }
  }
  return null;
}

/** Write rotated credentials back. Not optional: the refresh token rotates, so
 *  dropping the new one strands the account at the next run. */
function saveCreds(creds) {
  const json = JSON.stringify(creds.data);
  if (creds.store === 'file') {
    mkdirSync(dirname(creds.path), { recursive: true });
    writeFileSync(creds.path, json, { mode: 0o600 });
    chmodSync(creds.path, 0o600);
    return;
  }
  // -U updates the existing item in place rather than erroring on duplicate.
  execFileSync('security', [
    'add-generic-password', '-U', '-s', KEYCHAIN_SERVICE,
    '-a', process.env.USER || 'claude', '-w', json,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

/** Exchange the refresh token for a fresh pair, and persist the rotation. */
async function refresh(creds) {
  const o = creds.data.claudeAiOauth || creds.data;
  const refreshToken = o.refreshToken || o.refresh_token;
  if (!refreshToken) die('stored credentials have no refreshToken — run `claude login` again');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // This is THE failure a person has to fix, so it does not just exit 1 into
    // a log nobody reads.
    await dieLoudly(creds.env || process.env,
      'ต่ออายุสิทธิ์เข้าถึง Claude ไม่สำเร็จ',
      `HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const t = await res.json();
  const next = {
    ...o,
    accessToken: t.access_token,
    refreshToken: t.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(t.expires_in || 0) * 1000),
  };
  if (creds.data.claudeAiOauth) creds.data.claudeAiOauth = next;
  else creds.data = next;
  saveCreds(creds);
  console.log('  (refreshed the access token and saved the rotated pair)');
  return next.accessToken;
}

/** A token good for at least REFRESH_MARGIN_MS, refreshing if needed. */
async function freshToken(env) {
  if (env.CLAUDE_OAUTH_TOKEN) return env.CLAUDE_OAUTH_TOKEN;
  const creds = loadCreds(env);
  if (creds) creds.env = env;
  if (!creds) {
    await alertHuman(env, 'ไม่พบข้อมูลเข้าสู่ระบบ Claude บนเซิร์ฟเวอร์',
      `looked for ${credFilePath(env)}`);
    die('no Claude credentials found.\n'
      + `  Looked for ${credFilePath(env)}`
      + (platform() === 'darwin' ? ` and Keychain service "${KEYCHAIN_SERVICE}".` : '.')
      + '\n  Run this on the machine signed in to the SAMO Claude account '
      + '(`claude login`), or set CLAUDE_OAUTH_TOKEN.');
  }
  const o = creds.data.claudeAiOauth || creds.data;
  const token = o.accessToken || o.access_token;
  const expiresAt = Number(o.expiresAt || 0);
  if (!token) die('stored credentials have no accessToken — run `claude login` again');
  if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) return refresh(creds);
  return token;
}

// ---------- reading the measurement ----------

/** Pull `utilization` + `resets_at` out of whichever shape the API returns.
 *  Anthropic has added windows before (the live response carries eight more,
 *  most of them null), so read the named window and leave the rest to `raw`. */
function readWindow(usage, key, limitKind) {
  const w = usage?.[key];
  if (w && w.utilization != null) {
    return {
      pct: Number(w.utilization),
      resetsAt: w.resets_at ? new Date(w.resets_at).toISOString() : null,
    };
  }
  const l = Array.isArray(usage?.limits)
    ? usage.limits.find((x) => x?.kind === limitKind) : null;
  if (l) {
    return {
      pct: l.percent == null ? null : Number(l.percent),
      resetsAt: l.resets_at ? new Date(l.resets_at).toISOString() : null,
    };
  }
  return { pct: null, resetsAt: null };
}

/**
 * Is measurement switched on?
 *
 * FAIL CLOSED, and that is the whole design of this function. Three things can
 * happen here and only one of them is "yes": the RPC can say true, it can say
 * false, or it can fail to answer — a network blip, a 500, a revoked grant. RLS
 * returns ZERO ROWS rather than an error when a read is refused, so "no answer"
 * arrives looking exactly like a successful empty response.
 *
 * Treating an unanswered question as "yes, keep polling" is the fail-open shape
 * this repo has been bitten by repeatedly (`coalesce(flag, false)`, `null in
 * (...)`, a left join), and here it would restore precisely the behaviour the
 * switch exists to stop: hammering Anthropic and alerting a human about a
 * condition nobody can fix. A skipped tick costs nothing — the next one is
 * fifteen minutes away and the board keeps its previous sample, which is the
 * posture this script already takes for a 429.
 */
async function monitoringEnabled(supaUrl, anonKey, accessToken) {
  let res;
  try {
    res = await fetch(`${supaUrl}/rest/v1/rpc/claude_monitoring_enabled`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch (e) {
    return { on: false, why: `could not reach Supabase to read the switch (${e.message})` };
  }
  if (!res.ok) {
    return { on: false, why: `switch read returned HTTP ${res.status}` };
  }
  const body = await res.text().catch(() => '');
  let value;
  try { value = JSON.parse(body); } catch {
    return { on: false, why: `switch read returned unparseable body: ${body.slice(0, 120)}` };
  }
  // `true` is the ONLY answer that means yes. null (no row / no grant), false,
  // a string, an object — all of them mean "do not poll".
  if (value === true) return { on: true, why: null };
  if (value === false) return { on: false, why: 'an admin switched measurement off' };
  return { on: false, why: `switch read returned ${JSON.stringify(value)}, which is not a yes` };
}

/**
 * Leave ~/samo-night/bookings.json for the night agent: the board's OWN answer
 * to "how much may be used right now without booking, and until when" —
 * `right_now` from get_claude_board(), i.e. claude_free_now(), the same number
 * the web shows people as "ใช้ได้เลยตอนนี้ โดยไม่ต้องจอง".
 *
 * WHY THE BOARD'S ANSWER AND NOT A LIST OF BOOKINGS. The agent is an unbooked
 * user, and the board already knows what an unbooked user may take: a booking
 * keeps its % in whichever 5-hour window it lands in (0159 — the window is
 * shared by whoever it covers), an ended booking's share is released because
 * its real cost is in the measured use (0159 §1), and the week holds back
 * every future booking (0158). Re-deriving any of that in the agent would be a
 * second copy of the rule that refuses people's bookings — and two copies
 * drift. So the agent obeys exactly what a person would be told.
 *
 * Names and purposes are stripped: the agent's process can read this file.
 * get_claude_board() raises without the `claude` permission, so a reporter that
 * lost it writes NO file and the agent waits — never an empty "nobody booked".
 * Called AFTER the sample insert, so the answer uses this tick's measurement.
 */
async function leaveNightAgentBoard(supaUrl, anonKey, accessToken) {
  const nightHome = join(homedir(), 'samo-night');
  if (!existsSync(nightHome)) return;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/get_claude_board`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      console.error(`  (night agent board NOT written: HTTP ${res.status})`);
      return;
    }
    const board = await res.json();
    const rn = board?.right_now;
    if (!rn || typeof rn !== 'object' || rn.free_pct == null || !rn.session
        || !Array.isArray(board.free_windows) || !Array.isArray(board.bookings)) {
      console.error('  (night agent board NOT written: the answer is missing right_now/free_windows/bookings)');
      return;
    }
    const slim = (b) => (b ? { starts_at: b.starts_at, ends_at: b.ends_at, pct: b.pct } : null);
    const tmp = join(nightHome, '.bookings.json.tmp');
    writeFileSync(tmp, JSON.stringify({
      sampled_at: new Date().toISOString(),
      // The RAIL: the board's answer for starting at every instant of the week
      // (claude_free_windows → claude_free_now per band). The agent looks up the
      // band holding NOW, because "how much if I start now" changes at each
      // booking's start − 5 h: 08:00 → 100%, 08:01 → 30%.
      free_windows: board.free_windows.map((w) => ({
        starts_at: w.starts_at, ends_at: w.ends_at, free_pct: w.free_pct,
        week_free_pct: w.week_free_pct, bound_by: w.bound_by,
      })),
      bookings: board.bookings.map(slim),
      right_now: {
        at: rn.at, free_pct: rn.free_pct, until: rn.until, reason: rn.reason, bound_by: rn.bound_by,
        session: rn.session, week: rn.week,
        live_booking: slim(rn.live_booking), next_booking: slim(rn.next_booking),
      },
    }));
    renameSync(tmp, join(nightHome, 'bookings.json'));
  } catch (e) {
    console.error(`  (could not leave the night agent its board copy: ${e.message})`);
  }
}

async function main() {
  const env = loadEnv();
  const supaUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  const email = env.CLAUDE_REPORTER_EMAIL;
  const password = env.CLAUDE_REPORTER_PASSWORD;

  if (!supaUrl || !anonKey) die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing');
  if (!email || !password) {
    die('CLAUDE_REPORTER_EMAIL / CLAUDE_REPORTER_PASSWORD missing. '
      + 'Use an account that holds the `claude` permission.');
  }

  // ---- 1. sign in as an ordinary account (RLS applies) ----
  // MOVED AHEAD OF THE MEASUREMENT IN 0167, and the order is the feature: the
  // switch lives in the database, so the database has to be asked BEFORE
  // anything touches Anthropic. Signing in first costs nothing — this run
  // signed in anyway, just later — and it means a paused reporter makes exactly
  // ZERO calls to their API, which is the point of the pause.
  const signIn = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) {
    die(`Supabase sign-in failed: HTTP ${signIn.status} ${await signIn.text().catch(() => '')}`);
  }
  const session = await signIn.json();
  if (!session?.access_token || !session?.user?.id) die('Supabase sign-in returned no session');

  // ---- 2. the switch (migration 0167) ----
  const gate = await monitoringEnabled(supaUrl, anonKey, session.access_token);
  if (!gate.on) {
    // Exit 0: a paused reporter is a normal state, not a failed unit. And no
    // alertHuman() on this path — the entire reason the switch exists is that
    // the alerts were the problem.
    //
    // NOT REFRESHING THE OAUTH TOKEN WHILE PAUSED IS DELIBERATE. The refresh
    // token rotates on use and lives ~12 days, so a pause longer than that
    // strands the credential and turning measurement back on needs one `claude
    // login` on the VM. Refreshing anyway would keep it alive — at the cost of
    // calling Anthropic every couple of hours while pretending to be switched
    // off, and, when the subscription is the thing that lapsed, failing and
    // alerting exactly as before. The board and the Discord notice both say so.
    console.log(`· ปิดการติดตามอยู่ — ${gate.why}. Skipping this tick;`
      + ' no call was made to the Claude API.');
    process.exit(0);
  }

  // ---- 3. the measurement ----
  const token = await freshToken(env);
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 429 is EXPECTED, not a fault. The usage endpoint rate-limits hard, and a
    // missed tick costs nothing — the next one is 15 minutes away and the board
    // simply keeps the previous sample. Critically it must NOT reach
    // alertHuman(): a throttling blip that pages someone about re-logging in is
    // how an alert channel gets muted, and then the real expiry goes unseen.
    // Exit 0 so systemd does not record a failed unit for a normal event.
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      console.log(`· rate-limited by the usage API${retry ? ` (retry-after ${retry}s)` : ''}`
        + ' — skipping this tick, the board keeps the previous sample');
      process.exit(0);
    }
    // 401/403 on a STATIC long-lived token is the one failure that path has,
    // and nothing here can fix it — a person must issue a new token. So it is
    // loud, like the refresh failure.
    if (res.status === 401 || res.status === 403) {
      // ⚠️ THIS MESSAGE USED TO RECOMMEND `claude setup-token`, WHICH IS WHAT
      // PRODUCES A 403. The header of this file has documented that since the
      // day it was written — setup-token mints a `user:inference` token with no
      // `user:profile` scope, so it can SPEND the subscription and cannot READ
      // it — and the alert told a human to go and do it anyway, in the same
      // embed whose วิธีแก้ field says `claude login`. Two contradictory
      // instructions in one message, four times a day.
      await dieLoudly(env, 'สิทธิ์เข้าถึงข้อมูลการใช้งาน Claude หมดอายุ',
        `usage API HTTP ${res.status}. `
        + 'เกิดจากโทเคนหมดอายุ หรือบัญชี Claude ยังไม่ได้ต่ออายุ — '
        + 'ถ้ายังไม่ต่ออายุ ให้ปิดการติดตามไว้ก่อนที่หน้า จองโควตา Claude '
        + '(ปุ่มสถานะด้านบนของกระดาน) แทนการปล่อยให้แจ้งเตือนซ้ำ');
    }
    die(`usage API HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const usage = await res.json();

  const fiveHour = readWindow(usage, 'five_hour', 'session');
  const sevenDay = readWindow(usage, 'seven_day', 'weekly_all');
  if (fiveHour.pct == null && sevenDay.pct == null) {
    die(`neither five_hour nor seven_day found. Keys: ${Object.keys(usage).join(', ')}`);
  }

  // ---- 3b. the night agent's copy (2026-10-13) ----
  // The night agent decides whether a run may START from these four numbers —
  // it keeps one 5-hour session of the week for the owner — but it has no
  // database access by design, and polling oauth/usage itself would compete
  // with this sampler. So the one poller leaves a local copy beside the agent.
  // Only percentages and reset times: nothing in it is a credential. Written
  // only where the agent is installed, and atomically, so the runner never
  // reads half a file.
  const nightHome = join(homedir(), 'samo-night');
  if (existsSync(nightHome)) {
    try {
      const tmp = join(nightHome, '.usage.json.tmp');
      writeFileSync(tmp, JSON.stringify({
        sampled_at: new Date().toISOString(),
        five_hour_pct: fiveHour.pct, five_hour_resets_at: fiveHour.resetsAt,
        seven_day_pct: sevenDay.pct, seven_day_resets_at: sevenDay.resetsAt,
      }));
      renameSync(tmp, join(nightHome, 'usage.json'));
    } catch (e) {
      console.error(`  (could not leave the night agent its usage copy: ${e.message})`);
    }
  }

  // ---- 4. write the sample ----
  const ins = await fetch(`${supaUrl}/rest/v1/claude_usage_samples`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      five_hour_pct: fiveHour.pct,
      five_hour_resets_at: fiveHour.resetsAt,
      seven_day_pct: sevenDay.pct,
      seven_day_resets_at: sevenDay.resetsAt,
      raw: usage,
      reported_by: session.user.id,
    }),
  });
  const body = await ins.text().catch(() => '');
  if (!ins.ok) die(`insert failed: HTTP ${ins.status} ${body.slice(0, 300)}`);
  // RLS returns zero rows rather than an error on a blocked INSERT, so an empty
  // array is a REFUSAL, not a success. Same rule as the app's delete guard:
  // check the rows, never just the status.
  let parsed = [];
  try { parsed = JSON.parse(body); } catch { /* leave empty → treated as refusal */ }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    die('insert returned no row — the reporter account probably lacks the `claude` permission');
  }

  // ---- 5. the night agent's copy of the BOARD (2026-10-18) — after the insert,
  // so its answer is computed from the sample this tick just wrote.
  await leaveNightAgentBoard(supaUrl, anonKey, session.access_token);

  console.log(`✓ sample written · 5h ${fmt(fiveHour.pct)} · 7d ${fmt(sevenDay.pct)}`);
  if (sevenDay.resetsAt) console.log(`  weekly resets ${sevenDay.resetsAt}`);
}
const fmt = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

main().catch((e) => die(e?.stack || String(e)));
