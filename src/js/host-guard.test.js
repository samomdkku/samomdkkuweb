// ============================================================
// host-guard.test.js — the retired hosts redirect, and NOTHING ELSE does.
//
// Both entry HTMLs carry an inline script that forwards the two retired
// pages.dev deployments to /moved.html. Until 2026-08-27 it tested
// /\.pages\.dev$/ — ANY pages.dev host — which was correct while pages.dev
// meant "retired", and became a trap the moment previews were planned onto
// pages.dev (docs/TEAM-WORKFLOW.md §1 + D8): every per-PR preview URL would
// have bounced to the "we've moved" splash, and the cause would have looked
// like a broken deploy rather than a four-year-old redirect.
//
// This tests the REGEX THAT SHIPS, pulled out of the HTML — not a copy of it
// living in the test, which would just agree with itself. And it tests EVERY
// entry: fixing one and not the other is this repo's most repeated shape.
//
// ⚠️ SIX ENTRIES SINCE THE 2026-09-04 REPO MERGE, and the count is the point.
// Passport used to live in its own repository with its own copy of this guard,
// and its copy still tested /\.pages\.dev$/ — ANY pages.dev host — EIGHT DAYS
// after this one was narrowed, because no test could see across a repo
// boundary. Now all six are here.
//
// ⚠️ THE MERGE ALSO WIDENED WHAT EACH GUARD MUST CATCH, which is easy to miss.
// Passport is now served UNDER samoweb's hosts (/passport/), including the
// RETIRED ones. Its old predicate named only samomdkkupassport.pages.dev, so a
// visitor to samomdkkuweb.pages.dev/passport/ would have been served passport
// from a retired host with no bounce at all — against the dev database, with
// nothing saying so. All six entries therefore share ONE predicate naming all
// three retired hosts, and the last test below pins that they stay identical.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const ENTRIES = [
  'index.html',
  'admin/index.html',
  // Passport's four built entries (passport/vite.config.js `input`). Fixing
  // index.html alone would leave three — which is exactly what happened in the
  // separate repo.
  'passport/index.html',
  'passport/html/dashboard.html',
  'passport/html/admin.html',
  'passport/html/scan.html',
];

/** The live predicate, extracted from the shipped inline script. */
function guardFor(file) {
  const html = readFileSync(ROOT + file, 'utf8');
  const m = /if \((\/[^\n]*?\/i)\.test\(location\.hostname\)/.exec(html);
  expect(m, `${file}: no hostname guard found — did the inline script move?`).toBeTruthy();
  const re = eval(m[1]);
  return (host) => re.test(host);
}

// Only the RETIRED PRODUCTION hosts. Nothing else — see below.
const MUST_REDIRECT = [
  'samomdkkuweb.pages.dev',
  'refactorsamomdkkuweb.pages.dev',
  // Passport's own retired host. Still served by a Cloudflare project that is
  // deliberately kept alive, because 82% of printed QR posters name it
  // (docs/PASSPORT-MONOREPO.md §3) — so this must keep bouncing, not 404.
  'samomdkkupassport.pages.dev',
];

const MUST_NOT_REDIRECT = [
  'samo.md.kku.ac.th',        // production
  'localhost',                // dev
  '127.0.0.1',
  // The whole point of narrowing: previews live on pages.dev too — and,
  // measured on the Cloudflare API 2026-08-27, they are served BY the
  // `samomdkkuweb` project at <hash>.samomdkkuweb.pages.dev. A subdomain of a
  // retired project is therefore a PREVIEW, not something retired. Redirecting
  // these would kill every per-PR preview and look like a broken build.
  'abc123.samomdkkuweb.pages.dev',
  'deadbeef.refactorsamomdkkuweb.pages.dev',
  'samo-preview.pages.dev',
  'some-other-project.pages.dev',
  // The preview the whole merge exists to make work. If this ever redirects,
  // the one-URL/one-login arrangement is dead and it looks like a broken deploy.
  'preview.samomdkkuweb.pages.dev',
  'preview.samomdkkupassport.pages.dev',
  'abc123.samomdkkupassport.pages.dev',
  // A PREFIX ATTACK. The pre-2026-09-04 passport guard, /\.pages\.dev$/,
  // matched this too; an unanchored or (^|\.)-style pattern would again.
  'evilsamomdkkupassport.pages.dev',
  'notsamomdkkuweb.pages.dev',
];

describe('the deprecated-host guard', () => {
  for (const file of ENTRIES) {
    describe(file, () => {
      const redirects = guardFor(file);

      it('redirects both retired hosts and their preview subdomains', () => {
        const missed = MUST_REDIRECT.filter((h) => !redirects(h));
        expect(missed, `${file}: a RETIRED host would no longer be forwarded to /moved.html`)
          .toEqual([]);
      });

      it('redirects nothing else — production, dev, or a preview URL', () => {
        const wrong = MUST_NOT_REDIRECT.filter((h) => redirects(h));
        expect(wrong, [
          `${file}: a host that must NOT be redirected is being sent to /moved.html.`,
          'If a preview URL is in this list, every per-PR preview is dead on arrival',
          'and it looks like a broken deploy rather than this redirect.',
        ].join('\n')).toEqual([]);
      });
    });
  }

  it('all six entries carry the SAME predicate', () => {
    const found = ENTRIES.map((f) => {
      const html = readFileSync(ROOT + f, 'utf8');
      const m = /if \((\/[^\n]*?\/i)\.test\(location\.hostname\)/.exec(html);
      expect(m, `${f}: no hostname guard — did the inline script move or get dropped?`).toBeTruthy();
      return [f, m[1]];
    });
    const [, first] = found[0];
    const drifted = found.filter(([, re]) => re !== first).map(([f]) => f);
    expect(drifted, [
      'These entries guard different hosts from the others — one was edited alone.',
      'That is the shape that let passport ship an un-narrowed guard for eight days',
      'while this repo was correct. One predicate, six files.',
    ].join('\n')).toEqual([]);
  });

  // A control. Without it a rename could empty ENTRIES-in-practice and every
  // loop above would vacuously pass.
  it('actually inspected six entries', () => {
    expect(ENTRIES.length).toBe(6);
  });
});
