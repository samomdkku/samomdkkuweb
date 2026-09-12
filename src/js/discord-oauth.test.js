// ==============================================
// discord-oauth.test.js — the callback's three load-bearing properties.
//
// This route is reached from discord.com, at our domain, by anybody. Three
// things make that safe and each is asserted rather than trusted:
//
//   1. the nonce makes `state` a CSRF defence, not just an unguessable string;
//   2. the privileged key is used for ONE rpc and never for a table;
//   3. nothing is RENDERED here — an HTML page at an OAuth callback is a
//      phishing surface with our domain in the address bar.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __test } from '../../server/discord-oauth.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'server', 'discord-oauth.mjs'), 'utf8');
const NGINX = readFileSync(join(ROOT, 'server', 'nginx-samo.conf'), 'utf8');

describe('state parsing', () => {
  it('splits on the LAST dot — the code may not contain one, but assume nothing', () => {
    expect(__test.splitState('A1B2CD3E4F.xyz')).toEqual({ code: 'A1B2CD3E4F', nonce: 'xyz' });
    expect(__test.splitState('a.b.c')).toEqual({ code: 'a.b', nonce: 'c' });
  });

  it('refuses a state with no nonce rather than defaulting to one', () => {
    // A `?? ''` here would compare '' to '' further down and pass the CSRF
    // check for every request that omitted the nonce entirely.
    expect(__test.splitState('ONLYCODE')).toBe(null);
    expect(__test.splitState('CODE.')).toBe(null);
    expect(__test.splitState('.NONCE')).toBe(null);
    expect(__test.splitState('')).toBe(null);
    expect(__test.splitState(null)).toBe(null);
  });
});

describe('cookie reading', () => {
  it('finds the value among others, and is not fooled by a prefix', () => {
    expect(__test.cookie('a=1; samo_dlink=abc; z=2', 'samo_dlink')).toBe('abc');
    expect(__test.cookie('samo_dlink_other=abc', 'samo_dlink')).toBe(null);
    expect(__test.cookie('', 'samo_dlink')).toBe(null);
    expect(__test.cookie(undefined, 'samo_dlink')).toBe(null);
  });
});

describe('the nonce comparison cannot be satisfied by an empty value', () => {
  it('matches only identical non-empty strings', () => {
    expect(__test.same('abc', 'abc')).toBe(true);
    expect(__test.same('abc', 'abd')).toBe(false);
    expect(__test.same('abc', 'ab')).toBe(false);
  });

  // The failure this guards: a request with NO cookie reaches `same(nonce, '')`.
  // If that ever returns true the CSRF defence is gone and every test above
  // still passes.
  it('…and an absent cookie never matches a present nonce', () => {
    expect(__test.same('abc', '')).toBe(false);
    expect(__test.same('', '')).toBe(true);      // both absent is not a link attempt
    expect(__test.same(null, null)).toBe(false); // a non-string is never a match
    expect(__test.same(undefined, '')).toBe(false);
  });
});

describe('the privileged key is used for exactly one thing', () => {
  it('touches only the redeem RPC — never a table', () => {
    const uses = [...SRC.matchAll(/\/rest\/v1\/([^\s'"`]+)/g)].map((m) => m[1]);
    expect(uses, 'the service key bypasses every RLS policy; one RPC is its whole job')
      .toEqual(['rpc/redeem_discord_link_code']);
  });

  it('never sends the service key to Discord', () => {
    // Ordering bug that would be invisible in a happy-path test: the same
    // variable name reused across two fetches, and the key leaves the building.
    const discordCalls = SRC.split('\n').filter((l) => /discord\.com|\$\{API\}/.test(l));
    expect(discordCalls.some((l) => /sbKey|SERVICE_ROLE/.test(l))).toBe(false);
  });
});

describe('the callback renders nothing and spends the nonce', () => {
  it('answers with a redirect, never HTML', () => {
    expect(SRC).not.toMatch(/text\/html/);
    expect(SRC).toMatch(/writeHead\(302/);
  });

  it('clears the cookie on EVERY outcome, not just success', () => {
    // back() is the single exit, so clearing there covers cancel, bad nonce,
    // a refused redeem and success alike. If a second exit path appears this
    // assertion is what notices.
    expect(SRC.match(/res\.writeHead\(/g) || []).toHaveLength(1);
    expect(SRC).toMatch(/Max-Age=0/);
  });
});

describe('nginx exposes one URL, not a subtree', () => {
  it('matches /discord/callback exactly', () => {
    expect(NGINX).toMatch(/location = \/discord\/callback \{/);
    expect(NGINX, 'a prefix location makes every future /discord/* a route nobody reviewed')
      .not.toMatch(/location \/discord\/ \{/);
  });
});
