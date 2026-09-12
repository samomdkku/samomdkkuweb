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
import { db } from './db.js';

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

  const { data, error } = await db.rpc('issue_discord_link_code');
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
  const { data, error } = await db.rpc('my_discord_link');
  if (error) return null;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function unlinkDiscord() {
  const { data, error } = await db.rpc('unlink_my_discord');
  if (error) throw new Error(error.message || 'ยกเลิกการเชื่อมไม่สำเร็จ');
  // A DELETE that matched nothing answers success. 0186 returns a boolean for
  // exactly this reason, so a stale card cannot report an unlink that never
  // happened.
  if (data !== true) throw new Error('ไม่พบการเชื่อมบัญชีที่จะยกเลิก');
  return true;
}

/**
 * Paint the เชื่อมบัญชี Discord card into a slot on ข้อมูลของฉัน.
 *
 * ⛔ IT PAINTS NOTHING WHEN THE SERVER IS NOT CONFIGURED, and the slot's
 * `:empty` rule then hides it entirely. A button that can only fail is worse
 * than no button: it sends a person to Discord, through a consent screen, and
 * back to an error that is not their fault.
 *
 * ⛔ AND NOTHING WHEN THE PERSON IS NOT IN ทีม SAMO. 469 of 628 accounts are in
 * that state — ordinary students who are not in the team and have no Discord
 * roles to receive. Showing them a card whose only outcome is
 * "ต้องเข้าสู่ระบบด้วยอีเมลที่อยู่ในทะเบียน" invents a problem they do not have.
 * `my_discord_link()` returning nothing cannot distinguish "not linked" from
 * "not in the registry", so the membership question is asked separately.
 */
export async function renderDiscordCard(slot, opts = {}) {
  if (!slot) return;
  const outcome = opts.outcome ?? null;

  let cfg = null;
  try { cfg = await fetch('/discord/config').then((r) => r.json()); } catch { /* offline */ }
  if (!cfg?.ready) { slot.innerHTML = ''; return; }

  const [link, inTeam] = await Promise.all([myDiscordLink(), isInTeam()]);
  if (!link && !inTeam) { slot.innerHTML = ''; return; }

  const esc = (x) => String(x ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = link?.linked_at
    ? new Date(link.linked_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  slot.innerHTML = `
    <section class="myseat-block dlink" data-dlink>
      <span class="myseat-label"><i class="bi bi-discord" aria-hidden="true"></i> Discord</span>
      ${outcome ? `<p class="dlink-said dlink-said--${esc(outcome.kind)}" role="status">${esc(outcome.text)}</p>` : ''}
      ${link ? `
        <p class="dlink-state">เชื่อมบัญชีแล้ว${when ? ` เมื่อ ${esc(when)}` : ''}</p>
        <p class="dlink-help">ระบบจะให้ role ตามฝ่ายและตำแหน่งของคุณใน ทีม SAMO โดยอัตโนมัติ</p>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-dlink-unlink>ยกเลิกการเชื่อม</button>
      ` : `
        <p class="dlink-help">เชื่อมบัญชี Discord เพื่อรับ role ของฝ่ายและตำแหน่งของคุณโดยอัตโนมัติ</p>
        <button type="button" class="btn btn-sm btn-dlink" data-dlink-start>
          <i class="bi bi-discord" aria-hidden="true"></i> เชื่อมบัญชี Discord
        </button>
      `}
      <p class="dlink-err" data-dlink-err hidden></p>
    </section>`;

  const err = slot.querySelector('[data-dlink-err]');
  const say = (msg) => { err.textContent = msg || ''; err.hidden = !msg; };

  slot.querySelector('[data-dlink-start]')?.addEventListener('click', async (e) => {
    // Disable BEFORE the await. A second click while the first is in flight
    // mints a second code, and issuing invalidates the first — so the person
    // is sent to Discord carrying a state that was just voided, and comes back
    // to "รหัสไม่ถูกต้อง" having done nothing wrong.
    e.currentTarget.disabled = true;
    say('');
    try { await startDiscordLink(); }
    catch (ex) { say(ex?.message || 'เชื่อมบัญชีไม่สำเร็จ'); e.currentTarget.disabled = false; }
  });

  slot.querySelector('[data-dlink-unlink]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    say('');
    try {
      await unlinkDiscord();
      await renderDiscordCard(slot);
    } catch (ex) { say(ex?.message || 'ยกเลิกไม่สำเร็จ'); e.currentTarget.disabled = false; }
  });
}

/**
 * Is the signed-in person in ทีม SAMO at all?
 *
 * Asked through the registry the same way `issue_discord_link_code` asks, so
 * the card and the button cannot disagree about who may link — two
 * implementations of one rule drift, and the drift here shows as a button that
 * appears and then refuses.
 */
async function isInTeam() {
  const { data, error } = await db.rpc('my_person_id');
  return !error && !!data;
}

export const __test = { SAID, NONCE_COOKIE };
