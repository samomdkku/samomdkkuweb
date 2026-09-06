import { defineConfig } from 'vite';
import { applyDevDatabaseEnv, describeDevDatabase } from './tools/dev-env.mjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Inline-include partials at build time. Used by both entries.
function htmlPartials() {
  return {
    name: 'html-partials',
    transformIndexHtml(html) {
      return html.replace(/<include src="(.*)"\s*\/>/g, (match, src) => {
        const filePath = path.resolve(__dirname, src);
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf-8');
        }
        return match;
      });
    }
  };
}

// Stamp every build with a short id and emit it at /build.json. The
// runtime fetches build.json with no-store on every page load and
// compares it to the embedded __BUILD_ID__ — on mismatch it forces a
// cache-busting reload so a stale Safari HTML cache can never pin a
// user on an old bundle. See src/js/build-check.js.
function buildIdPlugin() {
  const buildId = crypto.randomBytes(6).toString('hex');
  // The release version travels WITH the build id. The id answers "is this tab
  // running the newest bundle"; the version answers "which release is deployed",
  // which is the question you actually ask when a user reports a bug. Read from
  // package.json so there is exactly one source of truth — see docs/VERSIONING.md.
  const version = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
  ).version;
  const payload = JSON.stringify({ buildId, version });
  return {
    name: 'build-id',
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
          __APP_VERSION__: JSON.stringify(version),
        },
      };
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: payload });
    },
    // In dev, expose the same id through /build.json so build-check
    // never thinks dev is "stale" (it'd reload-loop otherwise).
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/build.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(payload);
          return;
        }
        next();
      });
    },
  };
}

// SPA fallback for dev. With multi-page input, Vite doesn't auto-rewrite
// arbitrary paths to a root entry, so /pr or /news/123 would 404 in dev.
// This middleware rewrites public-app paths to /index.html so the
// in-app router (main.js pathToTab) can resolve them. Mirrors the
// production Cloudflare _redirects.
function spaFallback() {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '/';
        // Pass through admin paths — they have their own entry.
        if (url.startsWith('/admin')) return next();
        // Skip Vite internals + static asset requests.
        if (url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/')) return next();
        if (url === '/' || url === '/index.html') return next();
        // Has a file extension (.js .css .png .ico .svg etc.) — leave alone.
        if (/\.[a-zA-Z0-9]{1,6}(\?|$)/.test(url)) return next();
        // Public SPA route — rewrite to root entry. The in-app router
        // reads location.pathname directly so the URL bar still shows /pr.
        req.url = '/';
        next();
      });
    },
  };
}

// Dev-only stand-in for the `/notify` service.
//
// In production `/notify` is a Node service on the VM (server/notify-server.mjs)
// wrapping functions/notify.js, and it holds the Discord webhook URLs as
// secrets. `npm run dev` has neither, so every notify POST used to fail — a
// 404 from Vite's SPA fallback, parsed as JSON, surfacing as a confusing error
// on a form that had actually saved fine.
//
// docs/TEAM-WORKFLOW.md §1: on LOCAL, Discord is "printed to the terminal".
// This is that. It NEVER forwards anywhere — a dev machine holding a real
// webhook URL is exactly what the service exists to avoid — so it cannot
// notify a real ฝ่าย channel by accident, which is the failure that matters.
//
// ⚠️ This is the DEV SERVER only. Preview builds on Cloudflare do not run
// vite.config.js at all; their Discord path is a dev webhook (#samo-dev-bot),
// which is phase 2 and not built.
function notifyDevStub() {
  return {
    name: 'notify-dev-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/notify', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, stub: true, note: 'dev stub — nothing is sent' }));
          return;
        }
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 1e6) { req.destroy(); }
        });
        req.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { /* print it raw below */ }
          const action = parsed?.action || '(no action)';
          console.log(`\n\u001b[33m[notify:dev]\u001b[0m ${action} — NOT SENT (dev stub)`);
          console.log(parsed ? JSON.stringify(parsed, null, 2).slice(0, 2000) : body.slice(0, 2000));
          res.setHeader('Content-Type', 'application/json');
          // Same success shape the real handler returns, so client code that
          // checks it takes the SAME branch it would in production.
          res.end(JSON.stringify({ success: true, stub: true }));
        });
      });
    },
  };
}

// ── /passport/ must reach the proxy, not the SPA fallback ──────────────────
// Measured, because the proxy alone was not enough and the failure was subtle:
// /passport/js/index.js proxied fine (200 text/javascript) while /passport/
// returned the PORTAL's HTML. Vite's SPA history fallback claims directory-style
// URLs — anything ending in "/" — and rewrites them to the root index.html
// before the proxy ever sees them. Asset URLs have an extension, so they were
// never claimed, which is why the two behaved differently and why "the proxy
// works" was true and useless.
//
// So normalise the URL first. This plugin's middleware is registered in the
// body of configureServer, which Vite installs BEFORE its own — including the
// fallback. By the time anything else looks, /passport/ is /passport/index.html
// and the proxy takes it.
const passportDirIndex = {
  name: 'samo-passport-dir-index',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url || '').split('?');
      const q = query ? `?${query}` : '';
      if (/^\/passport(\/.*)?$/.test(path)) {
        // ⛔ Never touch Vite's own machinery or dependencies: /passport/@vite/client,
        // /passport/@fs/…, /passport/node_modules/… have no file extension either,
        // and appending .html to them breaks HMR with no obvious cause.
        const internal = path.includes('/@') || path.includes('/node_modules/');
        const last = path.slice(path.lastIndexOf('/') + 1);
        if (!internal) {
          if (path === '/passport') req.url = `/passport/index.html${q}`;
          else if (path.endsWith('/')) req.url = `${path}index.html${q}`;
          // Extensionless deep link, e.g. /passport/html/dashboard. Production
          // resolves these through nginx's `$uri.html` try_files — old printed QR
          // codes depend on it — so dev has to do the same or the two disagree
          // about a URL people actually hold.
          else if (last && !last.includes('.')) req.url = `${path}.html${q}`;
        }
      }
      next();
    });
  },
};

const config = {
  root: '.',
  plugins: [passportDirIndex, notifyDevStub(), buildIdPlugin(), htmlPartials(), spaFallback()],
  build: {
    outDir: 'dist',
    // Multi-page build — public site at /, operator app at /admin/.
    // Same Supabase, same Cloudflare project; two bundles so public
    // visitors don't download admin code. Pattern follows Stripe /
    // Vercel / Linear: public marketing + dedicated operator app.
    rollupOptions: {
      input: {
        public: path.resolve(__dirname, 'index.html'),
        admin:  path.resolve(__dirname, 'admin/index.html'),
      },
    },
  },
  server: {
    port: 5174,
    open: true,

    // ── /passport/ works in `npm run dev` too ────────────────────────────
    // Passport and the portal became one project in September 2026, but the
    // join originally happened only at BUILD time: `npm run dev` served the
    // portal alone, and /passport/ answered 200 with the PORTAL'S OWN HTML —
    // the wrong page wearing the right URL, with no error to notice. Anyone
    // sent to fix something in Passport opened /passport/ and saw the portal.
    //
    // Passport runs its own Vite on 5173 (it needs its own root, plugins and
    // html-includes), so this proxies to it rather than trying to serve two
    // roots from one server. That works because Vite already rewrites
    // passport's root-absolute asset paths with its base in DEV as well as in
    // build: the dev HTML asks for /passport/css/main.css and
    // /passport/js/index.js, never /css or /js. Everything it needs is under
    // the one prefix, so one proxy rule is enough.
    //
    // `npm run dev` starts BOTH servers (tools/dev-all.mjs). If you start this
    // one alone, /passport/ fails to connect — which is the honest answer, and
    // better than the portal pretending to be Passport.
    proxy: {
      '/passport': {
        target: 'http://localhost:5173',
        changeOrigin: false,
        ws: true,
      },
    },
  },
};

export default defineConfig(({ command }) => {
  // ⛔ `serve` ONLY. On `build` the Supabase values must come from the VM's own
  // .env.local and nothing else — tools/dev-env.mjs says what goes wrong
  // otherwise. This gate IS the safety property, and dev-env.test.js asserts
  // that both vite configs still have it.
  if (command === 'serve') {
    const decision = applyDevDatabaseEnv();
    // Vitest loads this config too, and its `command` is also 'serve'. The
    // mapping is still wanted there; the banner is not — it is a line for
    // somebody starting a dev server, not for a test run.
    if (!process.env.VITEST) process.stdout.write(describeDevDatabase(decision));
  }
  return config;
});
