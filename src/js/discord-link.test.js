// ==============================================
// discord-link.test.js — the browser half's two traps.
//
// Both are things that look fine in a happy-path click-through and are wrong
// on the second visit or in a hostile one.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'src', 'js', 'discord-link.js'), 'utf8');

// ⛔ ASSERT AGAINST CODE, NOT PROSE. The first draft of the scope assertion
// went red on this file's OWN comment — "no email, no guild list" — which is
// the mistakes log's "satisfied by PROSE" trap arriving from the other side: a
// guard that reads documentation instead of behaviour is wrong either way.
// The shared stripper exists because four tests once hand-rolled this and one
// of them blanked 13,839 characters before a single assertion ran.
const CODE = stripComments(SRC);

// readDiscordOutcome touches window/history, so exercise it with doubles
// rather than importing db.js (which wants a live Supabase client).
const { readDiscordOutcome } = await (async () => {
  const mod = await import('./discord-link.js').catch(() => null);
  return mod || {};
})();

describe('the outcome is consumed, not just read', () => {
  const run = (hash) => {
    const loc = { hash, pathname: '/', search: '' };
    const calls = [];
    const hist = { replaceState: (a, b, url) => { calls.push(url); loc.hash = ''; } };
    return { out: readDiscordOutcome(loc, hist), calls };
  };

  it('reads a plain outcome and clears it from the URL', () => {
    const { out, calls } = run('#discord=ok');
    expect(out.kind).toBe('success');
    // ⛔ THE CLEAR IS THE POINT. Left in the hash, "เชื่อมเรียบร้อย" survives a
    // reload and a bookmark, and greets somebody who has just failed.
    expect(calls).toEqual(['/']);
  });

  it('prefers the specific reason over the generic status', () => {
    expect(run('#discord=error&why=taken').out.text).toMatch(/ถูกเชื่อมกับคนอื่น/);
    expect(run('#discord=error&why=expired').out.text).toMatch(/หมดอายุ/);
  });

  it('says something sane for a reason it has never heard of', () => {
    // The server can grow a new tag before this file does. It must not render
    // `undefined` at a person.
    const { out } = run('#discord=error&why=wat');
    expect(out.kind).toBe('error');
    expect(out.text).toMatch(/ไม่สำเร็จ/);
  });

  it('returns null when there is no outcome, and touches nothing', () => {
    const { out, calls } = run('#tab=team');
    expect(out).toBe(null);
    expect(calls).toEqual([]);
  });

  it('keeps the rest of the hash instead of eating the route', () => {
    const { calls } = run('#discord=ok&tab=team');
    expect(calls[0]).toBe('/#tab=team');
  });
});

describe('the flow cannot send someone to Discord it cannot finish', () => {
  it('sets the nonce cookie BEFORE minting the code, and checks it stuck', () => {
    const cookieAt = CODE.indexOf('document.cookie =');
    const rpcAt = CODE.indexOf("supabase.rpc('issue_discord_link_code')");
    expect(cookieAt).toBeGreaterThan(0);
    expect(rpcAt).toBeGreaterThan(0);
    // In the other order, a browser that refuses cookies still gets sent to
    // Discord, and the failure comes back looking like a security warning.
    expect(cookieAt).toBeLessThan(rpcAt);
    expect(CODE).toMatch(/เบราว์เซอร์ปิดคุกกี้/);
  });

  it('uses SameSite=Lax — Strict drops the cookie on the way back', () => {
    expect(CODE).toMatch(/SameSite=Lax/);
    expect(CODE).not.toMatch(/SameSite=Strict/);
  });

  it('asks for `identify` and nothing more', () => {
    const scopes = [...CODE.matchAll(/set\('scope',\s*'([^']+)'/g)].map((m) => m[1]);
    expect(scopes, 'the consent screen shows the person exactly what was asked for')
      .toEqual(['identify']);
    expect(CODE).not.toMatch(/guilds\.join|email|bot\b/);
  });

  it('reads the client id from the server, never from a build-time var', () => {
    // A VITE_ var would give the id a second home beside /etc/samo-notify.env,
    // and the mismatch is silent: users authorize one application while the
    // callback authenticates against another.
    expect(CODE).toMatch(/fetch\('\/discord\/config'\)/);
    expect(CODE).not.toMatch(/import\.meta\.env/);
  });
});
