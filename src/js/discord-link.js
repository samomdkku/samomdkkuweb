// ==============================================
// discord-link.js — เชื่อมบัญชี Discord, the browser half.
//
// Discord OAuth2 (DISCORD-ROLE-SYNC.md §8e). The browser starts the flow
// itself, because it is ALREADY signed in — there is no server route to
// impersonate a session at. The server is involved only at the callback, which
// is the one step that needs a secret.
//
//   1. rpc issue_discord_link_code()  → CODE   (10 min, single use, this person)
//   2. mint a NONCE, set it as a cookie on this origin
//   3. → discord.com/oauth2/authorize?…&state=CODE.NONCE
//   4. Discord → /discord/callback → 302 back here with #discord=ok|error|cancelled
//
// ⛔ THE NONCE IS WHAT MAKES `state` A CSRF DEFENCE. A bare state token can be
// minted by an attacker and walked through a victim's browser, which binds the
// VICTIM's Discord account to the ATTACKER's person. Nobody can set a cookie
// for an origin they do not control, so a state that did not start in THIS
// browser cannot finish here. The server refuses the mismatch; this is the half
// that puts the cookie there.
// ==============================================
import { supabase } from './db.js';

const NONCE_COOKIE = 'samo_dlink';

/** Outcomes the callback can hand back, in the words a student should read. */
const SAID = {
  ok:        ['success', 'เชื่อมบัญชี Discord เรียบร้อยแล้ว'],
  cancelled: ['info',    'ยกเลิกการเชื่อมบัญชีแล้ว ยังไม่มีอะไรเปลี่ยน'],
  used:      ['error',   'ลิงก์นี้ถูกใช้ไปแล้ว — กดเชื่อมบัญชีใหม่อีกครั้ง'],
  expired:   ['error',   'ลิงก์หมดอายุแล้ว — กดเชื่อมบัญชีใหม่อีกครั้ง'],
  taken:     ['error',   'บัญชี Discord นี้ถูกเชื่อมกับคนอื่นอยู่แล้ว — ติดต่อฝ่าย IT'],
  badcode:   ['error',   'ลิงก์ไม่ถูกต้อง — กดเชื่อมบัญชีใหม่อีกครั้ง'],
  nonce:     ['error',   'เริ่มการเชื่อมบัญชีจากเครื่องนี้อีกครั้ง เพื่อความปลอดภัย'],
  state:     ['error',   'ลิงก์ไม่ครบ — กดเชื่อมบัญชีใหม่อีกครั้ง'],
  discord:   ['error',   'ติดต่อ Discord ไม่สำเร็จ — ลองใหม่อีกครั้ง'],
  server:    ['error',   'ระบบยังตั้งค่าไม่ครบ — แจ้งฝ่าย IT'],
};

/**
 * Read the outcome the callback redirected back with, and REMOVE it.
 *
 * Removing it is not tidiness. A result left in the hash survives a reload and
 * a bookmark, so "เชื่อมเรียบร้อย" would greet somebody who had just failed —
 * a message a renderer can turn ON must be turned OFF by every other path that
 * reaches it. `replaceState` rather than clearing `location.hash`, which would
 * leave a bare '#' and scroll the page to the top.
 */
export function readDiscordOutcome(loc = window.location, hist = window.history) {
  const m = /[#&]discord=([^&]+)(?:&why=([^&]+))?/.exec(loc.hash || '');
  if (!m) return null;
  const status = decodeURIComponent(m[1]);
  const why = m[2] ? decodeURIComponent(m[2]) : null;
  const rest = (loc.hash || '').replace(/[#&]discord=[^&]*(&why=[^&]*)?/, '').replace(/^&/, '#');
  try { hist.replaceState(null, '', loc.pathname + loc.search + (rest === '#' ? '' : rest)); }
  catch { /* a sandboxed or file:// context — the message still shows */ }
  const [kind, text] = SAID[why || status] || SAID[status] || ['error', 'เชื่อมบัญชีไม่สำเร็จ'];
  return { status, why, kind, text };
}

/** A nonce the server can compare against the cookie. */
function mintNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Begin the flow.
 *
 * ⛔ THE COOKIE IS SET BEFORE THE CODE IS MINTED, NOT AFTER. If the rpc fails
 * we have set a harmless cookie and gone nowhere; in the other order, a browser
 * that refuses the cookie would still send the person to Discord for a round
 * trip that the callback must then reject as a nonce mismatch — a real failure
 * presented as a security warning.
 */
export async function startDiscordLink() {
  const cfg = await fetch('/discord/config').then((r) => r.json());
  if (!cfg?.ready) throw new Error('ระบบยังตั้งค่าไม่ครบ — แจ้งฝ่าย IT');

  const nonce = mintNonce();
  // SameSite=Lax so it survives the top-level redirect BACK from discord.com;
  // Strict would drop it there and every link would fail the nonce check.
  document.cookie = `${NONCE_COOKIE}=${nonce}; Path=/; Max-Age=900; SameSite=Lax; Secure`;
  if (!document.cookie.includes(`${NONCE_COOKIE}=`)) {
    throw new Error('เบราว์เซอร์ปิดคุกกี้อยู่ จึงเชื่อมบัญชีไม่ได้');
  }

  const { data, error } = await supabase.rpc('issue_discord_link_code');
  if (error) throw new Error(error.message || 'ขอลิงก์เชื่อมบัญชีไม่สำเร็จ');

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', cfg.client_id);
  url.searchParams.set('redirect_uri', cfg.redirect_uri);
  url.searchParams.set('response_type', 'code');
  // `identify` only. It returns an id, a username and an avatar — no email, no
  // guild list, no ability to act. Ask for the narrowest thing that answers the
  // question, because the consent screen SHOWS the person what they granted.
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', `${String(data).replace(/-/g, '')}.${nonce}`);
  url.searchParams.set('prompt', 'consent');
  window.location.assign(url.toString());
}

/** The caller's current link, or null. Never throws — this is a card, not a gate. */
export async function myDiscordLink() {
  const { data, error } = await supabase.rpc('my_discord_link');
  if (error) return null;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function unlinkDiscord() {
  const { data, error } = await supabase.rpc('unlink_my_discord');
  if (error) throw new Error(error.message || 'ยกเลิกการเชื่อมไม่สำเร็จ');
  // A DELETE that matched nothing answers success. 0186 returns a boolean for
  // exactly this reason, so a stale card cannot report an unlink that never
  // happened.
  if (data !== true) throw new Error('ไม่พบการเชื่อมบัญชีที่จะยกเลิก');
  return true;
}

export const __test = { SAID, NONCE_COOKIE };
