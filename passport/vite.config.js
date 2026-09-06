import { resolve } from 'path';
import { defineConfig } from 'vite';
import htmlIncludes from './vite-plugin-html-includes.js';
import { applyDevDatabaseEnv } from '../tools/dev-env.mjs';

// Passport's build, run from the samoweb repo root as a SECOND vite pass:
//   npm run build:passport   →   vite build --config passport/vite.config.js
//
// `root` is pinned to this directory so every path below resolves inside
// passport/ no matter where the command is run from — index.html, html/*.html
// and publicDir (passport/public: moved.html, qr-poster-template.png). Without
// it vite would take the repo root as its root and find samoweb's index.html.
const config = {
  root: __dirname,

  // ⚠️ THE BASE IS NOW ALWAYS '/passport/', AND THAT IS THE POINT OF THE MERGE.
  // Before the repos merged this defaulted to '/' because Cloudflare Pages
  // served passport at the root of its OWN project, while the KKU VM served it
  // at the /passport/ subpath — so the value had to differ per target and
  // server/deploy.sh passed PASSPORT_BASE=/passport/.
  //
  // Now there is one target shape: passport is built INTO samoweb's output at
  // dist/passport/, so it is reached at /passport/ everywhere — the VM via
  // nginx, and every Cloudflare preview via the files themselves. One base, no
  // per-target branch, and the preview finally matches production.
  //
  // The env override is kept only so a one-off build at a different prefix is
  // possible without editing this file; nothing in the repo sets it any more.
  base: process.env.PASSPORT_BASE || '/passport/',

  plugins: [htmlIncludes()],

  build: {
    // Into samoweb's dist, not passport's own. Path is relative to `root`.
    outDir: resolve(__dirname, '../dist/passport'),

    // ⛔ MUST STAY FALSE. This build runs AFTER the main one and writes inside
    // its output directory; emptying would delete the app that was just built.
    emptyOutDir: false,

    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'html/dashboard.html'),
        admin: resolve(__dirname, 'html/admin.html'),
        scan: resolve(__dirname, 'html/scan.html')
      }
    }
  }
};

// ⛔ `serve` ONLY — see tools/dev-env.mjs. Passport needs this MORE than the
// portal does: passport/js/app.js falls back to a HARDCODED production URL and
// anon key when VITE_SUPABASE_URL is unset, so before this existed a
// contributor running `npm run dev` reached the real student database at
// /passport/ while the portal half showed nothing at all. Unset must not mean
// production.
export default defineConfig(({ command }) => {
  if (command === 'serve') applyDevDatabaseEnv();
  return config;
});
