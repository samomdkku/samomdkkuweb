#!/usr/bin/env node
/**
 * Guard the bytes a visitor pays before first paint, and catch GrapesJS /
 * Quill / d3-org-chart sneaking into the eager path.
 *
 *   npm run build
 *   node tools/check-bundle.mjs
 *
 * WHY. CLAUDE.md: "GrapesJS, Quill, d3-org-chart — DYNAMIC IMPORT ONLY, never
 * an entry bundle." All three are genuinely heavy (GrapesJS ~1.1 MB raw,
 * d3-org-chart ~60 KB, html5-qrcode — same class of mistake, not one of the
 * three named, but the one actually FOUND this sweep — 338 KB) and each is
 * used by exactly one tab/feature, so the rule is "pay for it only if you
 * open that tab". 2026-10-20's speed sweep found the rule already broken
 * twice: `shop/orders.js` statically imported `shop/qr.js`, which also holds
 * the admin-only Html5Qrcode scanner, pulling it into the shared chunk every
 * public visitor downloads before first paint (split into qr.js / qr-order.js);
 * and `index.html` loaded Quill as a render-blocking `<script>` in `<head>`
 * on every page for an editor only the VitalSound tab uses (moved to
 * load-quill.js, fetched on first tab-open).
 *
 * HOW A STATIC IMPORT IS DETECTED. Grepping a chunk's CONTENT for a library's
 * name is unreliable — our OWN glue code legitimately references it (e.g.
 * org-graph.js's `const [{ OrgChart }] = await import('d3-org-chart')`
 * destructures `OrgChart` by name, so that string already appears in the
 * public entry chunk even in a correct build). The reliable signal is
 * Vite's OWN chunk graph: a dynamically-imported module gets its own chunk,
 * named by tools/chunk-names.mjs, that is fetched ONLY when the import()
 * runs. If someone changes a dynamic import to a static one, Rollup either
 * inlines the module into the chunk that now needs it eagerly, or — if the
 * module is ALSO reachable from elsewhere via dynamic import — keeps it as
 * its own chunk but Vite adds a `<link rel="modulepreload">` for it in the
 * entry HTML, so it is fetched eagerly anyway. Either way the entry's total
 * first-load bytes jump (caught by the budget below) AND, for a module whose
 * chunk name is predictable (grapes/d3-org-chart), that name starts showing
 * up in the entry's own modulepreload list (caught by name below). Proved
 * red by temporarily adding `import grapesjs from 'grapesjs'` to main.js:
 * the public entry gained a `grapes-*.js` modulepreload and ~1.1 MB.
 *
 * The budget is a BYTE CEILING, not a target — it exists to catch a
 * regression, not to be optimised toward. Raise it only with a reason
 * written beside the new number, same rule as check-context-budget.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// A LITTLE above today's AFTER-fix measured size (2026-10-20, this sweep):
// public 1,384,769 B raw (JS 1,043,228 + CSS 341,541); admin 1,696,640 B raw
// (JS 1,371,451 + CSS 325,189) — both measured from the real dist/ output,
// not vite's rounded console summary (class 7: verify from the artifact).
const BUDGETS = {
  public: 1_600_000,
  admin: 1_950_000,
};

// Vite's chunkFileNames hook (vite.config.js) routes every chunk name
// through tools/chunk-names.mjs's safeChunkName — 'grapes' and
// 'd3-org-chart' pass through unchanged (chunk-names.test.js pins this), so
// the prefix is a stable identifier for "this chunk IS the library", not
// just code that mentions it.
const DYNAMIC_ONLY_PREFIXES = ['grapes', 'd3-org-chart'];

/** Pull every `<script type="module" src="…">` and
 *  `<link rel="modulepreload" href="…">` / `<link rel="stylesheet"
 *  href="/assets/…">` from one built HTML file — the exact set of files a
 *  visitor's browser fetches before the entry module finishes evaluating,
 *  excluding external CDN tags (fonts.googleapis.com, cdn.jsdelivr.net, …),
 *  which this tool cannot and should not budget. */
function parseEntryHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const entryScript = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const modulePreloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  return { entryScript, modulePreloads, stylesheets, html };
}

function checkEntry(name, htmlRelPath, budget) {
  const htmlPath = path.join(DIST, htmlRelPath);
  if (!fs.existsSync(htmlPath)) {
    return { name, ok: false, problems: [`${htmlRelPath} does not exist — run npm run build first`] };
  }
  const { entryScript, modulePreloads, stylesheets } = parseEntryHtml(htmlPath);
  const jsFiles = [...entryScript, ...modulePreloads].filter((f) => f.endsWith('.js'));
  const cssFiles = stylesheets.filter((f) => f.endsWith('.css'));

  const problems = [];
  let rawTotal = 0;
  let gzipTotal = 0;
  const detail = [];
  for (const f of [...jsFiles, ...cssFiles]) {
    const abs = path.join(DIST, f.replace(/^\//, ''));
    const buf = fs.readFileSync(abs);
    rawTotal += buf.length;
    gzipTotal += zlib.gzipSync(buf).length;
    detail.push(`    ${f} — ${buf.length.toLocaleString()} B raw`);
  }

  for (const f of [...entryScript, ...modulePreloads]) {
    const base = path.basename(f);
    const hit = DYNAMIC_ONLY_PREFIXES.find((p) => base.startsWith(p + '-') || base.startsWith(p + '.'));
    if (hit) {
      problems.push(
        `'${hit}' is eagerly loaded by the ${name} entry (${f}) — it must stay ` +
        `behind a dynamic import() (CLAUDE.md: DYNAMIC IMPORT ONLY). ` +
        `Check for a new static "import … from '${hit === 'grapes' ? 'grapesjs' : hit}'".`,
      );
    }
  }

  if (rawTotal > budget) {
    problems.push(
      `${name} entry's first-load JS+CSS is ${rawTotal.toLocaleString()} B raw, ` +
      `over budget (${budget.toLocaleString()} B). Find what grew — ` +
      `probably a static import that used to be dynamic.`,
    );
  }

  return { name, ok: problems.length === 0, problems, rawTotal, gzipTotal, detail };
}

function checkPublicHeadHasNoBlockingQuill() {
  // Quill is CDN-only (not an npm dependency), so it never shows up in a
  // chunk — the regression this guards is the one actually found: a
  // render-blocking `<script src="https://cdn.quilljs.com/…">` shipped in
  // `<head>` on every page. Scoped to the PUBLIC entry only: admin's creator
  // tab still loads Quill the old blocking way (and Cropper.js, Sortable.js
  // alongside it) — a known, separate, lower-traffic cost this sweep did not
  // touch (admin.js's own deep-link edit flow reads the Quill instance
  // synchronously outside any tab-shown event, so making it lazy needs more
  // care than this task's budget — see docs/state/night-agent.md Task 18).
  const htmlPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, problems: ['dist/index.html missing — run npm run build first'] };
  const html = fs.readFileSync(htmlPath, 'utf8');
  // A real <script src> / <link href> tag, not the boot watchdog's inline
  // diagnostic script — which legitimately NAMES "cdn.quilljs.com" in a
  // string literal, as one of the known sources to expect once
  // load-quill.js injects it later, and must not be mistaken for the tag
  // itself.
  if (/<(script|link)[^>]+(?:src|href)="[^"]*quilljs[^"]*"/i.test(html)) {
    return { ok: false, problems: ['dist/index.html still loads Quill eagerly from <head> — load it lazily via src/js/load-quill.js instead (see main.js setupVsQuill).'] };
  }
  return { ok: true, problems: [] };
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error('✗ dist/ does not exist — run `npm run build` first.');
    process.exit(1);
  }
  const results = [
    checkEntry('public', 'index.html', BUDGETS.public),
    checkEntry('admin', 'admin/index.html', BUDGETS.admin),
  ];
  const quillCheck = checkPublicHeadHasNoBlockingQuill();

  let allOk = true;
  for (const r of results) {
    const statusIcon = r.ok ? '✓' : '✗';
    console.log(`${statusIcon} ${r.name} entry: ${r.rawTotal?.toLocaleString() ?? '?'} B raw / ${r.gzipTotal?.toLocaleString() ?? '?'} B gzip (budget ${BUDGETS[r.name]?.toLocaleString()} B raw)`);
    if (r.detail) for (const line of r.detail) console.log(line);
    for (const p of r.problems) { console.log(`  ✗ ${p}`); allOk = false; }
  }
  console.log(`${quillCheck.ok ? '✓' : '✗'} public <head> has no blocking Quill tag`);
  for (const p of quillCheck.problems) { console.log(`  ✗ ${p}`); allOk = false; }

  if (!allOk) {
    console.error('\n✗ check:bundle FAILED.');
    process.exit(1);
  }
  console.log('\n✓ check:bundle passed.');
}

main();
