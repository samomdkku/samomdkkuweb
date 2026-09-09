#!/usr/bin/env node
// ============================================================
// asset-mime-check.mjs — every JavaScript asset the SERVED site references
// must come back with a JavaScript Content-Type.
//
//   node tools/asset-mime-check.mjs https://samo.md.kku.ac.th
//   npm run check:asset-mime -- https://samo.md.kku.ac.th
//
// WHY THIS EXISTS. `pdfjs-dist/build/pdf.worker.min.mjs?url` is the only .mjs
// Vite emits, and this box's mime.types has no entry for .mjs — so nginx fell
// through to `application/octet-stream`, and browsers REFUSE a module script
// served with a non-JS type. pdf.js loads that file as
// `new Worker(url, {type:'module'})`, so the e-sign modal ("ลงนาม" on a
// หนังสือโครงการ) was dead in every browser from the day it shipped, and
// pdf.js's own fallback re-fetches the SAME blocked URL. The database shows
// zero e-sign events, ever; every signature in the system was uploaded by hand.
//
// WHY NOTHING ELSE CAUGHT IT.
//   · `npm run build` is green — the file is emitted correctly.
//   · `npm test` is green — nothing about it is wrong in the repo.
//   · `vite dev` and `vite preview` both serve .mjs as JavaScript, so it works
//     on every developer machine and only fails on the VM.
//   · smoke-browser.mjs loads the LOGGED-OUT landing page, which never touches
//     the worker — a module only the professor's modal pulls in.
// The fault lives between the build and the host, which is precisely where
// this repo has no other instrument. Hence a check that asks the SERVED host.
//
// HOW IT FINDS THE ASSETS. It crawls: the page HTML, then every /assets/ script
// it names, then every chunk THOSE reference (dynamic imports, worker URLs).
// That is how the worker is reached at all — it is three hops from the HTML
// (admin entry → shared chunk → esign chunk → worker) and no shallower crawl
// sees it.
//
// THE CONTROL. An empty crawl, a renamed directory or a 404-ing host would all
// produce "0 bad assets" — green over a dead site. So the run FAILS unless it
// actually checked at least one .js AND at least one .mjs. If Vite ever stops
// emitting .mjs this check goes red and someone decides deliberately, rather
// than the guard quietly becoming decorative.
// ============================================================
const BASE = (process.argv[2] || 'https://samo.md.kku.ac.th').replace(/\/+$/, '');

// The entry points a browser can land on. /admin/ is the one that reaches the
// e-sign chunk; / alone would never find the worker.
const PAGES = ['/', '/admin/'];

const JS_TYPES = /^(application|text)\/(javascript|ecmascript)\b/i;
const ASSET_RE = /\/assets\/[A-Za-z0-9_.\-]+\.(?:js|mjs)/g;
const REL_RE = /["'`]\.\/([A-Za-z0-9_.\-]+\.(?:js|mjs))["'`]/g;

const seen = new Set();
const bad = [];
const checked = { js: 0, mjs: 0 };
let pageFailures = 0;
let notPresent = 0;

async function head(url) {
  // HEAD, then GET as a fallback: some static hosts answer HEAD differently,
  // and a check that silently skips what it cannot HEAD is worse than none.
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow' });
      if (res.ok) return { status: res.status, type: res.headers.get('content-type') || '', res };
    } catch { /* try the next method */ }
  }
  return null;
}

async function body(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : '';
  } catch { return ''; }
}

/** Check one asset's Content-Type, then follow what it references. */
async function walk(path, depth) {
  if (seen.has(path) || depth > 4) return;
  seen.add(path);
  const url = `${BASE}${path}`;
  const got = await head(url);
  // A path that does not resolve is almost always a string that merely LOOKS
  // like an asset — pdf.js carries a literal "/assets/pdf.worker.mjs" that is
  // never emitted. Skip it. A genuinely missing bundle is smoke-browser's job
  // (it asks the page's own __samoBooted signal); failing here on a 404 would
  // make this check go red for a reason it cannot actually diagnose.
  if (!got) { notPresent += 1; console.log(`  --  ${path} — not served (ignored)`); return; }

  const ext = path.endsWith('.mjs') ? 'mjs' : 'js';
  checked[ext] += 1;
  if (!JS_TYPES.test(got.type)) {
    bad.push({ path, type: got.type || '(none)' });
    console.log(`  ✗   ${path}  ->  ${got.type || '(no content-type)'}`);
  } else {
    console.log(`  ok  ${path}  ->  ${got.type.split(';')[0]}`);
  }

  const text = await body(url);
  if (!text) return;
  for (const m of text.match(ASSET_RE) || []) await walk(m, depth + 1);
  for (const m of [...text.matchAll(REL_RE)]) await walk(`/assets/${m[1]}`, depth + 1);
}

console.log(`\nasset MIME check: ${BASE}\n`);
for (const page of PAGES) {
  const html = await body(`${BASE}${page}`);
  if (!html) { console.log(`  ??  ${page} — page did not load`); pageFailures += 1; continue; }
  for (const m of html.match(ASSET_RE) || []) await walk(m, 0);
}

console.log(`\nchecked ${checked.js} .js + ${checked.mjs} .mjs`
  + (notPresent ? ` (${notPresent} unresolved path(s) ignored)` : ''));

const problems = [];
if (bad.length) {
  problems.push(`${bad.length} asset(s) served with a non-JavaScript Content-Type`);
  problems.push('  → nginx: `location ~ ^/assets/.+\\.mjs$ { default_type application/javascript; … }`');
}
// The control. Never let "nothing was wrong" and "nothing was looked at" print
// the same verdict.
if (checked.js === 0) problems.push('no .js asset was reached — the crawl found nothing, this run proves NOTHING');
if (checked.mjs === 0) problems.push('no .mjs asset was reached — either the build stopped emitting one (decide deliberately) or the crawl is broken');
if (pageFailures) problems.push(`${pageFailures} entry page(s) could not be loaded — the host is not answering`);

if (problems.length) {
  console.log('\nFAIL');
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log('\nPASS — every JavaScript asset is served as JavaScript');
