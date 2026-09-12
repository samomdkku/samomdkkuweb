// ==============================================
// discord-oauth.mjs — the callback half of "เชื่อมบัญชี Discord".
//
// Discord OAuth2 (`scope=identify`) is the standard way to bind a Discord
// account to an external identity — what Patreon, Twitch and Ko-fi do — and it
// is strictly stronger than a code the person retypes: it proves control of the
// DISCORD account as well as of the portal session, at the same moment, server
// side. See docs/DISCORD-ROLE-SYNC.md §8e.
//
// ⛔ ONLY THE CALLBACK IS SERVER-SIDE. The browser starts the flow itself:
// it is already signed in, so it calls issue_discord_link_code() over its own
// session and redirects to Discord. There is no /start route to protect, and
// no place for a session to be impersonated on the way out.
//
//   browser   rpc issue_discord_link_code()      → CODE
//   browser   set cookie samo_dlink=<nonce>, then go to discord.com/oauth2/…
//             …?client_id&redirect_uri&response_type=code&scope=identify
//               &state=CODE.NONCE
//   discord   → GET /discord/callback?code=<theirs>&state=CODE.NONCE
//   here      exchange code → GET /users/@me → id
//             check NONCE against the cookie
//             redeem_discord_link_code(CODE, id)
//
// ⛔ THE NONCE IS NOT DECORATION — it is what makes `state` a CSRF defence
// rather than just an unguessable string. A bare state token can be MINTED BY
// AN ATTACKER and walked through a victim's browser, which binds the VICTIM's
// Discord account to the ATTACKER's person. The nonce is set as a cookie on
// this origin immediately before the redirect, and nobody can set a cookie for
// an origin they do not control — so a state that did not start in THIS browser
// cannot finish here.
//
// ⛔ THE CODE IS SPENT SERVER-SIDE, NEVER BY THE BROWSER.
// redeem_discord_link_code() is deliberately not granted to `authenticated`
// (0185 §4): a client that could call it would be able to bind a code to a
// Discord id it does not control. So this route needs a privileged key — see
// SUPABASE_SERVICE_ROLE_KEY in .claude/rules/security.md — and uses it for
// EXACTLY ONE RPC. It must never touch a table with it; `discord-oauth.test.js`
// asserts that.
// ==============================================
const API = 'https://discord.com/api/v10';

/** Split "CODE.NONCE" without trusting either half's shape. */
function splitState(state) {
  const s = String(state || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0 || dot === s.length - 1) return null;
  return { code: s.slice(0, dot), nonce: s.slice(dot + 1) };
}

function cookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Constant-time-ish compare. Not a secret of high value, but free to do right. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Send the person back to the portal with an outcome it can render.
 *
 * ⛔ NEVER render the outcome here. This route is reached from discord.com and
 * an HTML page served at an OAuth callback is a phishing surface: it looks like
 * our site, at our domain, with content chosen by whatever hit the URL. A
 * redirect hands the result to the app that already has the person's session.
 */
function back(res, origin, status, detail) {
  const url = new URL('/', origin);
  url.hash = `discord=${encodeURIComponent(status)}`
    + (detail ? `&why=${encodeURIComponent(detail)}` : '');
  res.writeHead(302, {
    Location: url.toString(),
    // Spend the nonce whatever happened. A retry mints a new one.
    'Set-Cookie': 'samo_dlink=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly',
  });
  res.end();
}

export async function handleDiscordCallback(req, res, env, url) {
  const origin = env.PUBLIC_ORIGIN || 'https://samo.md.kku.ac.th';
  const id = env.DISCORD_CLIENT_ID;
  const secret = env.DISCORD_CLIENT_SECRET;
  const sbUrl = env.SUPABASE_URL;
  const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // A misconfigured server must say so to the LOG and stay vague to the browser:
  // "which secret is missing" is not a thing to publish at a public URL.
  if (!id || !secret || !sbUrl || !sbKey) {
    console.error('[discord-oauth] not configured:',
      ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
        .filter((n) => !env[n]).join(', '));
    return back(res, origin, 'error', 'server');
  }

  // The person pressed Cancel on Discord's consent screen. Not an error.
  if (url.searchParams.get('error')) return back(res, origin, 'cancelled');

  const grant = url.searchParams.get('code');
  const parts = splitState(url.searchParams.get('state'));
  if (!grant || !parts) return back(res, origin, 'error', 'state');

  if (!same(parts.nonce, cookie(req.headers.cookie, 'samo_dlink') || '')) {
    // The flow did not start in this browser. See the header note: this is the
    // whole reason the nonce exists.
    console.warn('[discord-oauth] nonce mismatch — refused');
    return back(res, origin, 'error', 'nonce');
  }

  let discordUserId;
  try {
    const tok = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'authorization_code',
        code: grant,
        redirect_uri: `${origin}/discord/callback`,
      }),
    });
    if (!tok.ok) throw new Error(`token exchange HTTP ${tok.status}`);
    const { access_token: at } = await tok.json();

    const me = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${at}` } });
    if (!me.ok) throw new Error(`identify HTTP ${me.status}`);
    discordUserId = (await me.json()).id;
    if (!/^[0-9]{15,25}$/.test(String(discordUserId || ''))) throw new Error('no snowflake');
  } catch (e) {
    console.error('[discord-oauth] exchange failed:', e.message);
    return back(res, origin, 'error', 'discord');
  }

  // The ONE privileged call. Everything this route knows about the person came
  // from the code they were issued while signed in; everything it knows about
  // the Discord account came from Discord. Neither half was supplied by the
  // browser, which is the property the whole flow exists to have.
  try {
    const r = await fetch(`${sbUrl}/rest/v1/rpc/redeem_discord_link_code`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_code: parts.code, p_discord_user_id: discordUserId }),
    });
    const body = await r.text();
    if (!r.ok) {
      // 0185 raises a DISTINCT, already-Thai message per cause. Pass its shape
      // through as a short tag rather than the raw body — a database error at a
      // public URL is a disclosure, and the app has its own wording anyway.
      const tag = /ถูกใช้ไปแล้ว/.test(body) ? 'used'
        : /หมดอายุ/.test(body) ? 'expired'
        : /เชื่อมกับคนอื่น/.test(body) ? 'taken'
        : /ไม่ถูกต้อง/.test(body) ? 'badcode' : 'server';
      console.warn('[discord-oauth] redeem refused:', tag);
      return back(res, origin, 'error', tag);
    }
  } catch (e) {
    console.error('[discord-oauth] redeem failed:', e.message);
    return back(res, origin, 'error', 'server');
  }

  return back(res, origin, 'ok');
}

export const __test = { splitState, cookie, same };
