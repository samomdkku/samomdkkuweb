// ==============================================
// nginx-routes.test.js — every route the app cannot work without must be in
// the config a reinstall would install.
//
// ⛔ WHY THIS EXISTS, AND WHAT IT CANNOT DO.
//
// `/discord/config` and `/discord/callback` were added to the LIVE nginx by
// hand, and for a while `server/nginx-samo.conf` did not have them. Installing
// the repo copy — the documented way to install nginx config — would therefore
// have silently deleted เชื่อมบัญชี Discord, with nothing in any log: nginx
// would simply fall through to `location /` and serve the SPA index for the
// OAuth callback, which looks like a working page and never reaches the Node
// service. `docs/state/HANDOFF.md` §14b recorded that as a trap with "no guard
// exists for this".
//
// This is that guard, and it is honest about its reach: it can only assert that
// the REPO copy still declares each route, which is what makes a reinstall
// safe. It cannot see the live file — no test can, the VM is behind a VPN — so
// the other direction (someone hand-edits the live config and never mirrors it)
// stays a human step, documented in skills/discord-role-sync.md.
//
// ⛔ It asserts the routes as a PROPERTY of a LIST THAT NAMES WHY EACH MATTERS,
// not a copy of what the file happens to contain today. A guard written from
// the same list the code came from passes a wrong list back to itself
// (.claude/rules/mistakes.md class 7).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONF = readFileSync(
  join(import.meta.dirname, '..', '..', 'server', 'nginx-samo.conf'), 'utf8',
);

/** Route → what breaks, in user-visible terms, if nginx stops serving it. */
const REQUIRED = {
  '= /notify': 'every Discord notification silently no-ops — PR, VS, โครงการ, Claude',
  '= /discord/config': 'เชื่อมบัญชี Discord cannot read the client id, so the button does nothing',
  '= /discord/callback': 'Discord OAuth returns to the SPA index instead of the service, so nobody can ever link',
  '/admin/': 'the admin SPA serves the PUBLIC index, so /admin/ silently becomes the public site',
  '/passport/': 'the passport app 404s — and 82% of printed QR posters point at it',
  '/docs/': 'the docs site stops serving',
  '/vault/': 'the team password vault stops serving',
  '/assets/': 'hashed bundles lose their immutable cache',
  '= /build.json': 'the stale-bundle self-heal cannot see a new build',
};

describe('the nginx config a reinstall would install still has every route', () => {
  it('read the real file', () => {
    expect(CONF).toContain('server {');
    expect(CONF.length).toBeGreaterThan(2000);
  });

  for (const [route, breaks] of Object.entries(REQUIRED)) {
    it(`declares \`location ${route}\` — without it, ${breaks}`, () => {
      // Tolerant of spacing (`location = /x` and `location =/x` are both legal)
      // but anchored to a real location directive, so a mention in a COMMENT
      // does not satisfy it — a guard matched by prose is this repo's most
      // repeated instrument failure.
      const body = CONF.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
      const pattern = new RegExp(
        `location\\s+${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^=\s*/, '=\\s*')}\\s*\\{`,
      );
      expect(pattern.test(body), `server/nginx-samo.conf no longer declares ${route}.\n`
        + `If it was removed on purpose, say so; otherwise installing this file\n`
        + `over the live config would mean: ${breaks}`).toBe(true);
    });
  }

  // THE CONTROL. Without it, a pattern that matches nothing would report a
  // clean sweep for ever and every assertion above would be decoration.
  it('its detector would notice a missing route', () => {
    const body = CONF.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(/location\s+=\s*\/a-route-that-was-never-added\s*\{/.test(body)).toBe(false);
  });

  // The exact-match choice is load-bearing and easy to "tidy" into a prefix.
  // `location /discord/` would hand the whole subtree to the Node service, so
  // any future /discord/anything becomes a route nobody reviewed.
  it('the Discord routes are EXACT matches, never a /discord/ prefix', () => {
    const body = CONF.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(body).not.toMatch(/location\s+\/discord\/\s*\{/);
  });
});

// PLAUSIBLE, HANDOFF §18f: nginx's DEFAULT proxy_cache_key includes the query
// string ($is_args$args). The /img/ location's upstream fetch to lh3 only
// ever uses the two regex captures ($1=$2) — the incoming request's query
// string never reaches proxy_pass at all — so a request that happens to
// carry one (nothing in THIS repo appends one today; a future caller, a
// browser retry param, or a pasted link's tracking suffix could) would still
// buy its own cold lh3 fetch and its own cache slot for content identical to
// one already cached. Pin the key to what actually varies the content.
describe('the /img/ picture cache keys on the Drive id + size, not the query string', () => {
  /** The body of the location block whose `location` line CONTAINS `marker`
   *  (the regex location's own pattern has far more between its head and its
   *  opening brace than a fixed-width match can skip over, so this locates
   *  the brace by scanning forward, then counts braces from there —
   *  structural, not a line range: docs/mistakes/frontend-ui.md, "NEVER
   *  SLICE SOURCE BY LINE NUMBER"). */
  function locationBody(conf, marker) {
    const body = conf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const at = body.indexOf(marker);
    if (at < 0) throw new Error(`marker ${marker} not found`);
    // The location HEAD is itself a regex that may contain its own braces
    // (`{20,100}`); the block's real opener is the `{` that closes the head
    // line, always preceded by the closing quote of the location pattern.
    const brace = body.indexOf('" {', at);
    if (brace < 0) throw new Error(`no closing '" {' after ${marker}`);
    let depth = 1;
    let i = brace + '" {'.length;   // past the quote, space, and the opening brace itself
    const start = i;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') depth -= 1;
    }
    return body.slice(start, i - 1);
  }
  const IMG_BLOCK = locationBody(CONF, 'location ~ "^/img/');

  it('pins proxy_cache_key to the two regex captures lh3 is actually fetched with', () => {
    expect(IMG_BLOCK).toMatch(/proxy_cache_key\s+"\$1=\$2"\s*;/);
  });
  it('the control: the extractor finds a real block, not an empty match', () => {
    expect(IMG_BLOCK).toMatch(/proxy_cache\s+img\s*;/);
    expect(IMG_BLOCK.length).toBeGreaterThan(200);
  });
});
