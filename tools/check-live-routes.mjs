#!/usr/bin/env node
// ============================================================
// check-live-routes.mjs — does the LIVE nginx still serve every route, or has
// one quietly fallen through to the public SPA?
//
// ⛔ THE FAILURE THIS EXISTS FOR ANSWERS HTTP 200. When a `location` block is
// missing, nginx does not 404 — it falls through to `location /` and serves the
// public SPA index. Measured on this host: a route that has never existed
// returns **200, text/html, 217,928 bytes** of a page that renders perfectly.
// So a status check is worthless here, and "I opened it and the site came up"
// is worse than worthless: it is the symptom being mistaken for health.
//
// `/discord/config` and `/discord/callback` were added to the live config BY
// HAND. `src/js/nginx-routes.test.js` now asserts the repo copy still declares
// every route, which makes a reinstall safe — but no test can see the live
// file, so this is the other half: ask the SERVED host what it answers.
//
// ⛔ EACH ROUTE IS IDENTIFIED BY A MARKER ONLY IT PRODUCES, never by "200" and
// never by size. /admin/ and / are both HTML and both large; what separates
// them is which entry bundle the HTML names.
//
//   node tools/check-live-routes.mjs                     # production
//   node tools/check-live-routes.mjs --origin http://…   # somewhere else
//
// Exit 0 = every route is itself. Exit 1 = at least one has fallen through, and
// it names which and what a person loses.
// ============================================================
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
const ORIGIN = flag('--origin') || 'https://samo.md.kku.ac.th';

// route → { want(res, body), breaks }
// `want` returns null when healthy, or a string saying what was seen instead.
const ROUTES = [
  {
    path: '/discord/config',
    breaks: 'เชื่อมบัญชี Discord cannot read the client id, so the button does nothing',
    want: (r, b) => (/application\/json/.test(r.type) && /"client_id"/.test(b)
      ? null : `${r.status} ${r.type} — expected JSON naming client_id`),
  },
  {
    path: '/discord/callback',
    // No code and no state, so the service redirects straight back. A
    // fall-through would be 200 text/html instead, which is the whole tell.
    breaks: 'Discord OAuth returns the SPA index instead of the service, so nobody can ever link',
    want: (r) => (r.status >= 300 && r.status < 400
      ? null : `${r.status} ${r.type} — expected a redirect, not a page`),
  },
  {
    path: '/notify',
    breaks: 'every Discord notification silently no-ops — PR, VS, โครงการ, Claude',
    want: (r, b) => (/application\/json/.test(r.type) && /samo-notify/.test(b)
      ? null : `${r.status} ${r.type} — expected the notify service to name itself`),
  },
  {
    path: '/build.json',
    breaks: 'the stale-bundle self-heal cannot see a new build',
    want: (r, b) => (/application\/json/.test(r.type) && /"buildId"/.test(b)
      ? null : `${r.status} ${r.type} — expected JSON naming buildId`),
  },
  {
    path: '/admin/',
    breaks: '/admin/ silently becomes the PUBLIC site — same look, none of the admin tabs',
    want: (r, b) => (/assets\/admin-/.test(b)
      ? null : `served HTML naming ${(b.match(/assets\/[a-z]+-/i) || ['no'])[0]} bundle, not admin-`),
  },
  {
    path: '/passport/',
    breaks: 'the passport app 404s — and 82% of printed QR posters point at it',
    want: (r, b) => (/\/passport\/assets\//.test(b)
      ? null : `served HTML that names no /passport/assets/ bundle`),
  },
  {
    path: '/docs/',
    breaks: 'the docs site stops serving',
    want: (r, b) => (/\/docs\/assets\//.test(b)
      ? null : 'served HTML that names no /docs/assets/ bundle'),
  },
];

// ⛔ THE CONTROL. A checker whose probe always passes reports a healthy site for
// ever. This path has never existed, so it MUST look like a fall-through — and
// if it ever stops looking like one, every verdict above is unreliable and this
// exits non-zero rather than quietly reporting success.
const CONTROL = '/a-route-that-has-never-existed';

async function probe(path) {
  const r = await fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
  return {
    status: r.status,
    type: r.headers.get('content-type') || '',
    body: r.status >= 300 && r.status < 400 ? '' : await r.text(),
  };
}

let bad = 0;
console.log(`ORIGIN ${ORIGIN}\n`);

const c = await probe(CONTROL);
const fallsThrough = c.status === 200 && /text\/html/.test(c.type) && /assets\/public-/.test(c.body);
if (!fallsThrough) {
  console.log(`⚠️  CONTROL: ${CONTROL} answered ${c.status} ${c.type}, not the public SPA.`);
  console.log('   Either this host no longer falls through — in which case the checks');
  console.log('   below are testing something else — or it is down. Not trusting them.');
  bad++;
} else {
  console.log(`control  ${CONTROL} → ${c.status} public SPA (fall-through looks like this)\n`);
}

for (const route of ROUTES) {
  let verdict;
  try {
    const r = await probe(route.path);
    verdict = route.want(r, r.body);
  } catch (e) {
    verdict = `request failed: ${e.message}`;
  }
  if (verdict) {
    bad++;
    console.log(`✗ ${route.path}`);
    console.log(`    ${verdict}`);
    console.log(`    if this route is gone: ${route.breaks}`);
  } else {
    console.log(`✓ ${route.path}`);
  }
}

console.log();
if (bad) {
  console.log(`✗ ${bad} problem(s). The live nginx is /etc/nginx/sites-available/default on the VM;`);
  console.log('  server/nginx-samo.conf in this repo is the copy an install would use.');
  console.log('  Back the live file up, edit it, `nginx -t`, reload — and mirror the edit here.');
  process.exit(1);
}
console.log('✓ every route is itself — nothing has fallen through to the SPA.');
