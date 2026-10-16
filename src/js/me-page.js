// ============================================================
// me-page.js — /me "ข้อมูลของฉัน", and the one row on the home page that
// leads to it.
//
// WHY A PAGE. The home page is everyone's: news, the tool rail, the banner.
// Signed in, it used to grow a long personal block under the greeting — the
// identity check, the ทีม SAMO card, ระบบบ้าน, Discord — which pushed the news
// below the fold on every visit, for a thing a person needs now and then.
// Apple's pattern is the account ROW: Settings opens with one line naming you,
// and everything about you is one tap behind it. So the cards live at /me,
// unchanged (my-seat.js, house/my-house.js, identity-check.js own them), and
// home keeps a row that says who you are and whether anything needs you.
//
// THE ROW MUST NOT HIDE WORK. The identity check used to sit ON the home page,
// and taking it off would quietly stop people from answering it. So the row
// carries the same signal: "มีข้อมูลรอให้คุณตรวจสอบ" whenever the check has a
// question or the ทีม SAMO record has a gap the person can fix — computed by
// the same functions the cards use, never a second opinion.
// ============================================================

import { escHtml } from './utils.js';
import { houseLabel } from './house/fields.js';
import { identityCheckState } from './identity-check.js';
import { ownIssues } from './my-seat.js';

/** The person's first letter for an avatar with no picture. A Thai leading
 *  vowel (เ แ โ ใ ไ) is written BEFORE the consonant it belongs to, so
 *  "เอกชัย" would otherwise draw a lone เ — take the consonant after it. */
export function initialOf(name) {
  const chars = [...String(name || '').trim()];
  const first = chars.find((c) => !/[\u0E40-\u0E44]/.test(c));
  return first ? first.toUpperCase() : '?';
}

/**
 * What the home row says under the greeting, and whether it raises the flag.
 * Pure — every input is something the cards already loaded.
 *   seat     loadMySeat()  → { postings: [...] } | null
 *   house    loadMyHouse() → student record | null
 *   identity loadIdentityStatus() → status | null
 */
export function summarizeMe({ seat, house, identity, fallback = '' } = {}) {
  const parts = [];
  const posting = (seat?.postings || [])[0];
  if (posting?.node) {
    const path = Array.isArray(posting.path) ? posting.path : [];
    const where = path[path.length - 1];
    parts.push(where && where !== posting.node ? `${posting.node} · ${where}` : posting.node);
  }
  if (house && house.house_id !== null && house.house_id !== undefined) {
    parts.push(houseLabel(house.house_id, house.house_name));
  }
  const line = parts.join(' · ') || fallback;
  const idState = identityCheckState(identity).kind;
  const needsYou = idState !== 'none' || ownIssues(seat).length > 0;
  return { line, needsYou };
}

/** Paint the home row's avatar: the account picture, else an initial. */
export function paintAvatar(img, initialEl, user) {
  if (!img || !initialEl) return;
  const pic = user?.picture || '';
  img.hidden = !pic;
  if (pic) img.src = pic; else img.removeAttribute('src');
  initialEl.hidden = !!pic;
  initialEl.textContent = initialOf(user?.name || user?.username);
}

/** The row's text and flag. `summary` from summarizeMe. */
export function paintHomeMe(user, summary) {
  const name = document.getElementById('homeUserName');
  const sub = document.getElementById('homeUserDept');
  const alert = document.getElementById('homeMeAlert');
  if (name) name.textContent = user?.name || user?.username || '';
  if (sub) sub.textContent = summary?.line || 'ดูและแก้ไขข้อมูลของฉัน';
  if (alert) alert.hidden = !summary?.needsYou;
  paintAvatar(document.getElementById('homeUserPic'), document.getElementById('homeUserInitial'), user);
}

/** The /me page's account group: how this account signs in. */
export function paintMeAccount(user) {
  const who = document.getElementById('meAccountWho');
  if (!who) return;
  const handle = user?.email || (user?.username ? `@${user.username}` : '');
  who.innerHTML = handle
    ? `เข้าสู่ระบบอยู่ในชื่อ <strong>${escHtml(handle)}</strong>`
    : 'เข้าสู่ระบบอยู่';
}

/**
 * The Discord link flow returns to `/#discord=…` (server/discord-oauth.mjs).
 * The card that reads that outcome lives on /me now, so a return to the home
 * page is moved there BEFORE the router runs — client-side, so the callback
 * (and everyone's half-finished link already in flight) keeps working.
 * Returns the path to use, or null to leave the URL alone.
 */
export function discordReturnPath(loc) {
  if (!/[#&]discord=/.test(loc.hash || '')) return null;
  if (loc.pathname !== '/' && loc.pathname !== '') return null;
  return `/me${loc.hash}`;
}
