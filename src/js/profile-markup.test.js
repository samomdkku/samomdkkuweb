// The account settings have TWO markups since 2026-10-31 — the admin modal
// (modal-profile.html) and the public /me rows (tab-me.html) — and ONE script,
// profile.js, that finds its controls by id. A control renamed or dropped in
// one markup would make that page's save button silently do nothing (every
// lookup is `?.`), so the ids are held to each other here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const JS = read('src/js/profile.js');
const MODAL = read('src/html/modal-profile.html');
const ME = read('src/html/tab-me.html');

const idsIn = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// Every id profile.js asks the document for.
const wanted = [...new Set([
  ...[...JS.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  // the id lists the repaint walks: ['profileNameAlert', 'profilePhoneAlert', …]
  ...[...JS.matchAll(/'(profile[A-Za-z]+)'/g)].map((m) => m[1]),
])];

// The modal's own frame and its read-only ทีม SAMO block: /me shows the full
// ทีม SAMO card above the settings, so it has neither.
const MODAL_ONLY = new Set(['profileModal', 'profileSeatSection', 'profileMySeat']);
// …and the one id that tells profile.js it is ON /me.
const PAGE_ONLY = new Set(['meSettings']);

describe('profile.js finds every control in BOTH markups', () => {
  it('the sweep found the controls (control: an empty list would pass anything)', () => {
    expect(wanted.length).toBeGreaterThan(25);
    expect(wanted).toContain('profileNameSaveBtn');
  });
  it('the admin modal has every id', () => {
    const have = idsIn(MODAL);
    expect(wanted.filter((id) => !PAGE_ONLY.has(id) && !have.has(id))).toEqual([]);
  });
  it('/me has every id except the modal frame', () => {
    const have = idsIn(ME);
    expect(wanted.filter((id) => !MODAL_ONLY.has(id) && !have.has(id))).toEqual([]);
  });
  it('the public page does not ALSO include the modal (duplicate ids)', () => {
    expect(read('index.html')).not.toMatch(/<include src="[^"]*modal-profile\.html"/);
    expect(read('admin/index.html')).toMatch(/<include src="[^"]*modal-profile\.html"/);
  });
  it('every /me row names a panel that exists, and every panel starts closed', () => {
    const have = idsIn(ME);
    const rows = [...ME.matchAll(/class="me-row me-set-row"[^>]*aria-controls="([^"]+)"/g)].map((m) => m[1]);
    expect(rows.length).toBe(5);
    expect(rows.filter((id) => !have.has(id))).toEqual([]);
    const panels = [...ME.matchAll(/<div class="me-set-panel" id="[^"]+"([^>]*)>/g)];
    expect(panels.length).toBe(rows.length);
    expect(panels.every((m) => /\binert\b/.test(m[1]))).toBe(true);
  });
  it('nothing on the public site still opens a modal that is not there', () => {
    expect(read('src/html/navbar.html')).not.toMatch(/samoOpenProfile/);
    expect(ME).not.toMatch(/samoOpenProfile/);
  });
});
