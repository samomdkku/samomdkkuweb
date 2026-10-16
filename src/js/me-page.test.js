// me-page.test.js — /me "ข้อมูลของฉัน" and the home account row.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialOf, summarizeMe, discordReturnPath } from './me-page.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
const home = read('src/html/tab-home.html');
const me = read('src/html/tab-me.html');
const navbar = read('src/html/navbar.html');
const main = read('src/js/main.js');
const index = read('index.html');

describe('initialOf', () => {
  it('takes the first letter, upper-cased', () => {
    expect(initialOf('claude test')).toBe('C');
    expect(initialOf('ภูริ')).toBe('ภ');
  });
  it('skips a Thai leading vowel — เอกชัย is อ, not a lone เ', () => {
    expect(initialOf('เอกชัย')).toBe('อ');
    expect(initialOf('ไพลิน')).toBe('พ');
  });
  it('an empty name still draws something', () => {
    expect(initialOf('')).toBe('?');
    expect(initialOf(null)).toBe('?');
  });
});

describe('summarizeMe — the home row', () => {
  const settled = { conflicts: [], confirmed_at: '2026-01-01' };
  const house = { house_id: 3, house_name: 'บ้านสาม', sai: 143 };
  const seat = { postings: [{ node: 'หัวหน้าฝ่าย', path: ['ฝ่ายดิจิทัล'], photo_url: 'x', full_name: 'ก ข',
    first_name: 'ก', last_name: 'ข', nickname: 'ค', student_id: '1', major: 'm', kkumail: 'a@kkumail.com', study_year: 1 }] };

  it('names the ตำแหน่ง and the บ้าน', () => {
    const s = summarizeMe({ house, identity: settled });
    expect(s.line).toBe('บ้านสาม');
    expect(s.needsYou).toBe(false);
  });
  it('falls back to what the account itself says', () => {
    expect(summarizeMe({ fallback: 'ฝ่าย IT' }).line).toBe('ฝ่าย IT');
    expect(summarizeMe({}).line).toBe('');
  });
  it('raises the flag for an open question or an unconfirmed record — the check moved off home and must not go quiet', () => {
    expect(summarizeMe({ house, identity: { conflicts: [{ field: 'x' }] } }).needsYou).toBe(true);
    expect(summarizeMe({ house, identity: { conflicts: [], confirmed_at: null } }).needsYou).toBe(true);
  });
  it('raises it for a gap the ทีม SAMO card itself lists (the same function, not a second opinion)', () => {
    const noPhoto = { postings: [{ ...seat.postings[0], photo_url: '' }] };
    expect(summarizeMe({ seat: noPhoto, identity: settled }).needsYou).toBe(true);
  });
  it('a ตำแหน่ง is named with the ฝ่าย it sits in', () => {
    expect(summarizeMe({ seat, house, identity: settled }).line).toBe('หัวหน้าฝ่าย · ฝ่ายดิจิทัล · บ้านสาม');
  });
});

describe('discordReturnPath', () => {
  it('moves a Discord return from the home page to /me, hash intact', () => {
    expect(discordReturnPath({ pathname: '/', hash: '#discord=ok' })).toBe('/me#discord=ok');
    expect(discordReturnPath({ pathname: '/', hash: '#discord=error&why=x' })).toBe('/me#discord=error&why=x');
  });
  it('leaves every other URL alone', () => {
    expect(discordReturnPath({ pathname: '/', hash: '' })).toBe(null);
    expect(discordReturnPath({ pathname: '/', hash: '#article/3' })).toBe(null);
    expect(discordReturnPath({ pathname: '/shop', hash: '#discord=ok' })).toBe(null);
  });
  it('the callback really does return to / (if it moves, this redirect is dead code)', () => {
    expect(read('server/discord-oauth.mjs')).toMatch(/new URL\('\/', origin\)/);
  });
});

describe('wiring', () => {
  it('/me is a route, the page is included, and its tab button exists', () => {
    expect(main).toMatch(/\{ path: '\/me',\s+tab: 'pills-me-tab' \}/);
    expect(index).toContain('src="./src/html/tab-me.html"');
    expect(navbar).toMatch(/id="pills-me-tab"[^>]*data-bs-target="#pills-me"/);
    expect(me).toContain('id="pills-me"');
  });

  it('the personal cards live on /me, not on home', () => {
    for (const id of ['meIdentityCheck', 'meMySeat', 'meMyHouse']) expect(me).toContain(`id="${id}"`);
    for (const id of ['homeIdentityCheck', 'homeMySeat', 'homeMyHouse']) expect(home).not.toContain(`id="${id}"`);
    expect(main).not.toMatch(/getElementById\('home(IdentityCheck|MySeat|MyHouse)'\)/);
  });

  it('every way in opens /me: home row, avatar menu, phone avatar, drawer strip', () => {
    expect(home).toMatch(/id="homeAuthSignedIn"[^>]*href="\/me"[^>]*data-dept-tool-tab="pills-me-tab"/);
    expect(navbar).toMatch(/onclick="activateTab\('pills-me-tab'\)">\s*<i class="bi bi-person-vcard me-2"><\/i>ข้อมูลของฉัน/);
    expect(navbar).toMatch(/id="navAuthSignedInMobile"[\s\S]*?onclick="activateTab\('pills-me-tab'\)"/);
    expect(navbar).toMatch(/id="mobileAuthSignedIn"[\s\S]*?onclick="activateTab\('pills-me-tab'\)"/);
  });

  it('the phone top bar no longer signs you out with one tap', () => {
    const btn = navbar.match(/<button[^>]*id="navAuthSignedInMobile"[\s\S]*?<\/button>/)[0];
    expect(btn).not.toContain('samoSignOut');
  });

  it('sign-out is still reachable signed in: /me and the drawer both carry it', () => {
    expect(me).toContain('onclick="samoSignOut()"');
    expect(navbar.match(/id="mobileSignOutItem"[\s\S]*?<\/li>/)[0]).toContain('samoSignOut()');
  });
});
