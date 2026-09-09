# Mistakes — Deploy, nginx & caching

The VM, the deploy script, and every layer between a build and a browser that already has one.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## `rsync --delete` on deploy yanks the previous build's chunks out from under OPEN tabs — and a load-time-only self-heal cannot rescue them

**Symptom** (reported live 2026-07-30): "I just test upload my picture and now the
web is down"… then, minutes later, "oh the web comes back now". Reads like the
upload broke production.
**It was not the upload.** Evidence, in the order it ruled things out:
- every endpoint 200, `/notify` healthy → server up;
- `nginx` active **9 days**, zero error-log lines, **zero restarts** → nginx never
  fell over;
- CPU **100% idle**, load average 6.50 decaying on a **2-core** box → the load was
  the deploy's `npm ci` + two vite builds, already finished;
- `team_members.updated_at` for the photo = **10:41:30 UTC**, deploy finished
  **10:29:59** → the upload SUCCEEDED, 11½ minutes after the deploy;
- the pre-deploy bundle `/assets/public-Cp4_CgAT.js` → **404**, the new one → 200.
**Cause**: `server/deploy.sh` published with `rsync -a --delete dist/ /var/www/…`,
which deletes the previous build's content-hashed assets the instant the new ones
land. A tab open ACROSS the deploy keeps running (its JS is already in memory) —
which is why the upload worked — but the moment it needs anything new it 404s.
This app has real lazy chunks: `await import('./esign.js')` in
`projects/inbox.js`, `./qr.js` in `shop/admin.js`. A reload fixes it, hence "comes
back now".
`src/js/build-check.js` exists for exactly this and still could not help: it runs
**once, at page load**, and the broken tab never loaded again.
**Fix**, three parts:
1. `deploy.sh` `publish()` — assets rsync **additively** (hashed names never
   collide, so keeping the old ones is free), everything else mirrors with
   `--delete --exclude=assets/`, then `find … -mtime +7 -delete` prunes. Note
   `--exclude` also protects those files from `--delete` unless you pass
   `--delete-excluded`.
2. `build-check.js` re-checks on `visibilitychange`→visible and on a bfcache
   `pageshow`, not just at load.
3. …but that re-check must NOT reload over unsaved work. This admin backgrounds
   constantly and is full of modals holding untyped-but-unsaved text. `pageIsIdle()`
   (no `.modal.show`/`.offcanvas.show`, no non-empty visible input) gates the
   foreground path; the page-load path passes `force: true` because nothing can be
   typed yet. **A self-heal that destroys user input is a worse bug than the one it
   fixes.**
**Rule**: never `--delete` content-hashed assets in the same step that publishes
their replacements — a deploy is not atomic from an open tab's point of view. And
any "reload to heal" mechanism needs an answer to "what if the user is mid-edit?".

---

---

## A deploy script that `git pull`s ITSELF and keeps running will execute a garbage fragment — bash reads a script by byte offset

**Symptom**: none yet — spotted while editing `server/deploy.sh`, one commit
before it would have fired.
**Cause**: bash does not slurp a script; it reads and executes incrementally,
tracking a BYTE OFFSET into the file. `deploy.sh` runs `git pull --ff-only` on the
repo it lives in. Any commit that changes the script's length shifts every byte
after that point, and bash resumes at its old offset inside the NEW file —
mid-token, mid-command, as root. It appears to work for years because the file
rarely changes, then corrupts exactly on the deploy that changes it. The change
that surfaced this added ~30 lines NEAR THE TOP, shifting everything.
**Fix**: pull, then re-exec, guarded by an env var so it cannot recurse:
```bash
if [ "${SAMO_DEPLOY_REEXEC:-}" != "1" ]; then
  cd "$WEB_DIR"; git pull --ff-only
  SAMO_DEPLOY_REEXEC=1 exec bash "$WEB_DIR/server/deploy.sh" "$@"
fi
```
Verified with stubbed `git`/`npm`/`sudo`: unset → pulls and re-execs exactly once;
set → skips the block entirely.
**The transition itself is the dangerous run**: the OLD script (no guard) is what
starts, pulls the new one, and continues at stale offsets. For the first deploy
after adding this, pull MANUALLY first so bash reads the new file from the top:
`cd ~/samo-projects/samomdkkuweb && git pull --ff-only && bash server/deploy.sh`.
**Rule**: any script that updates its own source must re-exec, and self-updating
scripts should be changed with an out-of-band pull for the transition.

---

---

## "Login is still there so the cache must be cleared" — localStorage and the HTTP cache are different buckets

**Symptom**: User reports a JS-level bug fixed on main, deploy is up
and `curl -I` confirms the new `Cache-Control: no-cache` header on
`/admin/`. User closes Safari, restarts iPad, comes back, sees they
are still signed in, and concludes "cache hasn't cleared" because
the JS fix still isn't visible.
**Cause**: Two different storage layers being confused.
- **localStorage** (`sb-<ref>-auth-token`, `samo.savedAccounts`,
  `projects.commentsSeenAt`, etc.) survives Safari restarts,
  device restarts, and tab closes. That's why the user is still
  signed in — completely independent of the HTTP cache.
- **HTTP cache** (the disk-cached copy of `/admin/index.html` and
  the JS bundle it references) is what carries the JS fix. iPad
  Safari keeps the cached HTML keyed by the cache headers that
  were on it AT THE TIME IT WAS CACHED — a later deploy that adds
  `Cache-Control: no-cache` only governs FUTURE fetches; it does
  NOT retroactively invalidate the cached copy.
So the iPad is happily serving stale HTML that points at the OLD
bundle hash, while the user sees "login still works → cache fine".
**Fix**: Three escalating options, in order:
1. Visit a fresh URL — `?v=2` or any querystring works because it's
   a different cache key. Verifies the new bundle without touching
   localStorage / signing out.
2. Settings → Safari → Advanced → Website Data → swipe-delete the
   entry for the site. iOS rolls localStorage into "Website Data"
   so this DOES sign the user out — fine, they re-sign-in.
3. Settings → Safari → Clear History and Website Data — last
   resort, nukes everything.
**Where it lives now**: `public/_headers` ships
`Cache-Control: no-cache, must-revalidate` on HTML so the NEXT
deploy after this fix won't re-trap a user, but the FIRST deploy
where this is added still requires one of the three steps above.
Pattern to recognise: any "fix shipped, deploy verified, user
still doesn't see it" report — first thing to check is whether
the user's HTML cache predates the `_headers` fix.

---

---

## CI `npm test` fails on Node 20 — supabase-js throws "Node.js 20 detected without native WebSocket support" at import

**Symptom**: Every GitHub Actions `build` run (build.yml) fails in ~18s,
on `main` AND `refactor/modular`, for many commits in a row. Tests pass
locally. The CI log's failing step is `npm test`, with
`Error: Node.js 20 detected without native WebSocket support.` →
`Process completed with exit code 1`. The build step is never reached.
**Cause**: `@supabase/supabase-js` (^2.106.1) → realtime-js hard-throws at
**import time** when `globalThis.WebSocket` is absent. Node 20 has no
global WebSocket; Node 22 ships a stable one. At least one Vitest file
transitively imports `src/js/db.js` (which imports `@supabase/supabase-js`),
so the throw fires the moment Vitest loads that module — before any test
runs. Tests pass locally only because the dev machine runs Node 22+.
(`npm run build` is unaffected: Vite *bundles* db.js, it never *executes*
its module-level code in Node — the WebSocket check only runs at real
import, i.e. in the browser at runtime and in the Node test process.)
**Fix**: Bump `node-version` in `.github/workflows/build.yml` from `'20'`
to `'22'`. Also bumped README "Prerequisites" to Node 22+ so contributors
don't hit the same wall locally. Do NOT pin CI back to Node 20 while on
this supabase-js line. If a future need forces Node 20, the alternative is
to stop the test process importing db.js (isolate the pure-helper tests) or
polyfill `globalThis.WebSocket` in the Vitest setup — bumping Node is the
cleaner fix.
**Where**: `.github/workflows/build.yml` (`node-version: '22'`); `README.md`
Quick start prerequisites.

---

---

## nginx subpath app: bare `/passport` (no trailing slash) silently serves the wrong SPA

**Symptom**: `https://samo.md.kku.ac.th/passport` stopped working — it served
the samoweb SPA (or "not found") instead of the passport app. `/passport/`
(with slash) was fine.
**Cause**: `location /passport/` is a prefix match that only matches URIs
*beginning with* `/passport/`. A bare `/passport` does NOT match it, so it fell
through to the catch-all `location /` whose `try_files … /index.html` serves
samoweb's index from `root /var/www/samo-web`. Nginx's built-in
trailing-slash auto-redirect (301 `/passport` → `/passport/`) only fires when
the active root actually contains a `passport` directory — but passport lives
at `/var/www/passport` (reached via the `root /var/www` override *inside* the
`/passport/` block), so under the catch-all's `/var/www/samo-web` root there's
no `passport` dir and the auto-redirect never triggers.
**Fix**: Add an exact-match redirect for the bare path, above the prefix block:
`location = /passport { return 301 /passport/; }`. `location =` (exact) always
wins over prefix matches, so ordering is safe.
**Where**: `server/nginx-samo.conf`. Apply the same `location = /foo { return
301 /foo/; }` pattern to ANY subpath-mounted app whose files live outside the
catch-all root. **`/admin` has the identical latent gap** (bare `/admin` →
samoweb catch-all) — patch it the same way if a bare `/admin` link ever ships.
To apply live on the VM: scp the config to the box, `sudo cp` it to
`/etc/nginx/sites-available/default`, `sudo nginx -t` (validates before
committing), `sudo systemctl reload nginx`.

---

---

## nginx without an `$uri.html` fallback breaks EXTENSIONLESS deep links that a retired Cloudflare-Pages host used to serve as clean URLs — old passport QR scans silently landed on the home page (no points)

**Symptom**: Old **printed** passport QR codes stopped stamping points/activities;
freshly-generated QR codes (from admin) worked. Scanning an old code showed the
pages.dev "we've moved" splash, then forwarded — but the user never earned the point.
Nothing errored.
**Cause**: Two facts collide.
- Old QR codes were generated when the app lived on Cloudflare Pages, which serves
  **clean URLs** — so they encode the **extensionless** path
  `/passport/html/scan?aid=..&tk=..` (no `.html`). New QRs are built from
  `ROUTES.SCAN = BASE + 'html/scan.html'` (WITH `.html`).
- The VM nginx `location /passport/` had `try_files $uri $uri/ /passport/index.html`
  — **no `$uri.html` step**. For `/passport/html/scan` (extensionless): `$uri` (no
  file `scan`), `$uri/` (no dir) both miss → nginx falls straight to
  `/passport/index.html` = the **home page**. The scan module never loads, the
  `aid`/`tk` params are dropped, no scan row is inserted. New `.html` QRs matched
  `$uri` directly, which is why only *old* codes failed.

  Confirmed live before/after with two curls comparing `<title>` (home
  "Samo Passport — Life is a Journey" vs scan "Stamping Passport..."). The token
  itself was fine — `generateStaticQR` never rotates `static_token`, so old and new
  codes for the same activity carry the same token; the break was purely path
  resolution.
**Fix**: Add the clean-URL fallback BEFORE the index fallback:
`try_files $uri $uri.html $uri/ /passport/index.html;`. Now
`/passport/html/scan` → `/passport/html/scan.html`. Edited `server/nginx-samo.conf`
AND applied live (backup → `sudo nginx -t` → `sudo systemctl reload nginx`; the
sudo password is piped from `.env.local` `SAMO_VM_SUDO_PASSWORD` over ssh — env vars
do NOT propagate over ssh, so `read -r PW` from stdin then `echo "$PW" | sudo -S`).
**Where**: `server/nginx-samo.conf` `location /passport/`. **Rule**: whenever an app
that ran on a clean-URL host (Cloudflare Pages, Netlify, `_redirects`) is re-hosted
on nginx, its `try_files` MUST include `$uri.html` or every extensionless deep link
(and every printed QR / old bookmark that predates the move) silently resolves to the
SPA index instead of the intended page. The public samoweb SPA is unaffected — it's a
single-`index.html` hash router with no sibling `.html` pages; the passport app is the
one with real per-page `.html` files (`dashboard.html`, `admin.html`, `scan.html`).

---

---

## Dropping a column while the SERVED bundle still names it — `42703` on the live admin tab

**Symptom**: minutes after applying a migration, ระบบบ้าน's admin tab in
production showed `{"code":"42703","message":"column students.year_override does
not exist"}` and loaded nothing. Reported by the owner while the session that
caused it was still running.

**Cause**: migration 0129 dropped five vestigial columns from `students`. The
LOCAL code had already stopped asking for them — `STUDENT_COLS` in
`src/js/house/api.js` was edited in the same commit — but that commit had not
been deployed. The bundle actually being served was the previous build, and it
still sent `select=…,year_override,is_listed,…`. PostgREST answers an unknown
column with **400 / 42703 on the whole query**, not by ignoring it, so
`fetchStudents()` threw and the entire workspace `reload()` failed.

Everything about the drop was checked first — no function body referenced the
columns, no trigger fired `of <column>`, every stored value was the default. The
one reader nobody checked was the artifact on the server, which is precisely the
reader `docs/mistakes/tooling-proofs.md` already says to check: *"grep the SERVED
bundle, not the local file."* That rule was written for verifying a fix. It
applies just as hard to verifying a **removal**.

**Fix**: deploy, then verify from the served bundle
(`curl <host>/assets/admin-*.js | grep -c year_override` → 0). ~20 minutes of
downtime on one admin tab.

**Where it lives now**: `supabase/migrations/0129_students_lose_the_vestigial_columns.sql`.

**Rule**: a schema REMOVAL and a code deploy are ordered, and the order is
**deploy first, drop second**. Adding a column is safe in either order because
old code simply does not ask for it; dropping one is not, because old code is
still asking. If the drop must go first, it is not a drop — it is a two-step:
ship the code that stops reading the column, confirm it is the version being
SERVED, then drop. The window between them is measured in whatever your deploy
takes, and during it the feature is down.

## `systemctl enable --now` reported success and scheduled nothing

**Symptom.** The Claude usage reporter's timer had been `disable`d by hand for
four days to stop a Discord alert loop. Re-enabling it with
`sudo systemctl enable --now samo-claude-usage.timer` printed the symlink line,
and `is-enabled` / `is-active` both answered `enabled` / `active`. It would
never have run again. The tell was one field:

```
NextElapseUSecMonotonic=infinity
NEXT  -   LEFT  -   LAST Fri 2026-08-21 17:15:24 UTC
```

An empty `NEXT` in `systemctl list-timers`, which nothing about the enable
command draws your attention to.

**Cause.** The unit had only monotonic triggers:

```ini
OnBootSec=3min
OnUnitActiveSec=15min
```

`OnBootSec` is measured from BOOT. The machine had been up for weeks, so that
trigger point was long past and consumed. `OnUnitActiveSec` only chains from a
run that has already happened, and the timer had not run since being disabled.
So nothing anchored a next elapse, and systemd correctly scheduled infinity —
there was no rule left that named a future instant.

The unit worked for months because it was enabled once, shortly after a boot,
and then never stopped. The failure needs a gap: `disable`, wait past the boot
window, `enable --now`. Which is exactly the workflow the new pause switch
(migration 0167) creates, and will create again.

**Fix.** `OnActiveSec=1min`, which is relative to the TIMER being started rather
than to boot or to a previous run. Enabling now always anchors a first run a
minute later, and `OnUnitActiveSec=15min` chains from there. Verified live: the
timer fired on its own at 16:19:44 and scheduled 16:34:44.

**Where it lives now.** `server/samo-claude-usage.timer`, with the measurement
in a comment on the line.

**The general rule.** *`enable` is not `schedule` — after enabling any timer,
read `NEXT` from `systemctl list-timers`, not `is-active`.* A unit whose only
triggers are relative to events that already happened is enabled, active, and
inert. Any timer that a human will ever stop and restart needs at least one
trigger anchored to the TIMER's own activation.

---

## "I grepped the served bundle for the string I just changed and it is not there — did the deploy fail?"

**Symptom.** A one-line copy fix to `src/js/db.js` was deployed to the VM.
`DEPLOY_EXIT=0`, VM `git log` matched local HEAD. Then the standing
verification step — grep the SERVED artifact for a string the change added —
found the new text in **0 of 27 bundles**. The old text was also gone, so the
evidence was equally consistent with "the deploy worked" and "the deploy
silently shipped nothing".

**Cause.** The string lives inside a guard on a build-time variable:

```js
const url = import.meta.env.VITE_SUPABASE_URL;
if (!url || !anonKey) { console.error('[db] Missing Supabase env vars…'); }
```

Vite **substitutes** `import.meta.env.*` at build time. On any build where the
variable is set — which is every real build, on the VM and on a developer's
machine alike — `!url` becomes `!"https://…"`, folds to `false`, and the minifier
deletes the whole branch. **The message ships only in a build that does not have
the values**, which is precisely the situation it exists to explain. It is not
missing from production; it cannot be in production.

**Fix.** Nothing to fix in the code. What was wrong was the verification. Proved
in both directions before believing it:

```bash
# with the vars present (the VM build, and a normal local build)
grep -l "Missing Supabase env vars" dist/assets/*.js        # → nothing
# with them blanked, which is when the message is meant to appear
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir /tmp/noenv
grep -c "Missing Supabase env vars" /tmp/noenv/assets/*.js  # → analytics-*.js:1
```

A control ran alongside it — a string known to ship (`อัปเดตไม่สำเร็จ`) greps 1 in
eight `analytics-*.js` chunks, so the grep and the path were both working.

**Where it lives now.** `src/js/db.js`, and this entry. `STATE.md` already warns
that a bundle grep can read 0 for reasons that are not "the deploy failed" —
minified module-scope names, and code landing in the SHARED chunk. This is the
third reason and the only one where the string is *deleted rather than renamed*.

**The general rule.** *A string behind a build-time flag is not in the artifact
you are grepping — it was compiled out.* Before concluding a deploy failed,
ask whether the code you changed can even be reached in this build's
configuration, and verify a change like that by building **with the flag in the
state that makes the branch live**. Pick a verification string from code that
runs unconditionally; a control that greps a string you know ships tells you
whether the instrument or the deploy is the problem.


## "There is no preview deploy" — the contributor guide denied a pipeline that had been running for weeks

**Symptom.** `CONTRIBUTING.md` told every contributor: *"There is no preview
deploy — Cloudflare Pages is retired, so nothing comments a per-branch URL.
Review visually by running `npm run dev` locally."* Per-PR previews had been
live since phase 3 of the dev system: Cloudflare builds every branch, comments
the link on the pull request, and points the build at `samo-dev`. Read back from
the Cloudflare API, not from a doc: `preview_deployment_setting: all`,
`pr_comments_enabled: true`, preview `VITE_SUPABASE_URL` = the dev project.

**Cause — one true sentence and one false one welded together.** Cloudflare
Pages *is* retired **as the production host** (the VM serves
`samo.md.kku.ac.th`). It is *not* retired as the **preview builder**. The
paragraph inferred the second from the first, and the inference was written
before previews were switched on, so it was true when written. Nothing
re-examined it afterwards: `docs/TEAM-WORKFLOW.md` §9 is an explicit list of the
files a landed phase must correct, `CONTRIBUTING.md` is on it, and every OTHER
entry on that list had been done — `README.md`, `.claude/rules/security.md`,
`skills/deploy-vm.md`. A checklist that is followed four times out of five reads
exactly like a checklist that was followed.

**The cost is not "a stale doc".** It is the one sentence a new ฝ่าย contributor
uses to decide how to test their change. It sent them to a local dev server
pointed at whatever their `.env.local` held — which, for anyone who had not been
handed the `SUPABASE_DEV_*` block, is production — while a preview wired to the
dev copy was being built for them and its link posted on their own PR.

**Fix.** The section now describes the real flow, names `npm run preview:url`,
and says the thing nobody had written down anywhere: **a preview points at
`samo-dev`, so it is safe to submit forms on.** Guard:
`src/js/preview-docs.test.js` — it fails if a contributor-facing doc denies
previews while `tools/preview-url.mjs` and the `preview:url` script exist, and
it also asserts the doc POSITIVELY explains them, because deleting the paragraph
would otherwise pass.

**Where it lives now.** `CONTRIBUTING.md`, `src/js/preview-docs.test.js`.

**The general rule.** *A retirement is scoped to a ROLE, not to a technology.*
"We stopped using X for A" does not license "X does nothing here" — name the
role you retired it from, and check every other role it still plays before
writing the general sentence. **And when a design lists the files a landed
change must correct, that list is a checklist, not prose**: work it in the same
commit that lands the change, because a half-worked list is indistinguishable
from a finished one to everyone who comes after.


## GitHub was silently DELETING words out of the docs, and nothing could tell us until we rendered them somewhere strict

**Symptom.** None reported — nobody reads a sentence and thinks "a word is
missing here". Found only because a VitePress build of `docs/` refused to
compile. Three places where the published documentation says less than the
source does, confirmed against **GitHub's own renderer**, which is how these
files are actually read:

```bash
gh api -X POST /markdown -f mode=gfm -f text='A full-screen "ย้ายไป <kkumail>" block.'
# → <p>A full-screen "ย้ายไป " block.</p>
```

**Cause — two different markdown rules, both invisible.**

1. **An unknown tag is DROPPED, not escaped.** `<kkumail>` and `<gmail>` are
   placeholders, but to a renderer they are HTML tags nobody knows, so the
   sanitiser removes them. The sentence keeps its punctuation and loses its
   subject: *"ย้ายไป "*. Two of these sat in `docs/state-archive/`.
2. **A line that STARTS with a tag begins an HTML block, and an HTML block
   interrupts the paragraph** — so an inline code span cannot cross into it.
   `docs/mistakes/authz-rls.md` had a span opened at the end of one line and
   closed on the next, which began `<table>`. GitHub emitted a literal
   backtick, an empty `<table>` element, and a sentence in pieces.

**Fix.** Wrap the placeholders in backticks; keep a code span on one line.
`0175`-era commit. Guards, in order of authority:

- **`npm run docs:build` inside the required `build` check.** The Vue compiler
  refuses to build any of the above. This is the real guard.
- **`src/js/md-raw-tags.test.js`** — a fast local approximation for the same
  rule, so the failure arrives before CI.

**⚠️ The approximation was WRONG THREE TIMES, in both directions**, which is
the part worth remembering:

| Miss | What it did |
|---|---|
| multi-line inline code spans | reported 20 false hits — "fixing" them would have rewritten SQL in five write-ups for no reason |
| fenced blocks inside a blockquote (`> ```bash`) | a "fix" applied to one put stray backticks INSIDE a code block |
| a tag-name regex that swallowed attributes | `<img src="x">` came back as a tag named `img src=` |

Each is now a fixture in that test. A fourth version would be wrong too if it
were written from the same list the code came from.

**Where it lives now.** `src/js/md-raw-tags.js` + its test,
`.github/workflows/build.yml`, `docs/.vitepress/config.mjs`.

**The general rule.** *A permissive renderer does not report your mistakes — it
performs them.* Markdown, HTML and SQL all fail this way: the output looks
finished, so nobody looks twice. **When you have a choice of renderers, the
STRICT one is the instrument**, even if you publish with the permissive one —
its refusal to build is the only signal you are going to get. And when you must
approximate a renderer with a regex, remember you are re-implementing a parser:
give each thing it got wrong a fixture, because the next version will get a
fourth thing wrong.

## A missing docs page answered HTTP 200, so a dead link looked healthy

**Symptom.** `https://samo.md.kku.ac.th/docs/NOPE` — a page that does not exist
— returned **200 OK**. The reader saw the correct "404" page; every machine saw
success.

**Cause.** The nginx block ended `try_files $uri $uri.html $uri/
/docs/404.html;`. A `try_files` fallback to a FILE serves that file with the
status of a normal hit. It looks right in a browser, which is how it passes
review, and it lies to everything that is not a human: link checkers, uptime
monitors, crawlers, and any script asserting a page exists. A broken link then
survives until somebody happens to mention it.

**Fix.** `try_files $uri $uri.html $uri/ =404;` with `error_page 404
/docs/404.html;`. The reader still gets the styled page; the status is honest.

**Where it lives now.** `server/nginx-samo.conf`, in the `location /docs/`
block, with the measurement that found it.

**The general rule.** **A fallback that RENDERS the right thing is not the same
as one that REPORTS the right thing.** Whenever a rule ends in "…otherwise serve
this instead", ask what status code goes out with it — the humans are fine
either way, and the instruments are the ones you are lying to. Probe the DENY
half of every route, not just the allow half: `/docs/CONTRIBUTE` returning 200
proved the routing worked and said nothing at all about `/docs/NOPE`.

## The deploy goes silent after "==> docs site" — CAUSE NOT YET FOUND

⚠️ **This entry was first written with a confident root cause (sudo's credential
expiring) and a fix. THE FIX DID NOT WORK — the deploy hung at the same point a
third time with the keep-alive in place.** The wrong version stood for about
twenty minutes. It is rewritten rather than deleted because a plausible,
well-argued, WRONG diagnosis in this file is more dangerous than a gap: the next
person trusts it and stops looking.

**Symptom.** `./server/deploy.sh` over ssh prints its three build headings, then
nothing. Three attempts on 2026-08-31 all stopped immediately after
`==> docs site: build with base /docs/`, and each ran until it was killed —
at 300 s, at 600 s, and manually at ~9 min. `==> fix permissions` and
`==> done` never appear. **The site stays completely healthy throughout**, and
the docs publish and nginx reload simply never happen.

**What is RULED OUT, by measurement:**

| Suspected | Measured | Verdict |
|---|---|---|
| Slow docs build | `DOCS_BASE=/docs/ npm run docs:build` on the VM | **10 s.** Not it |
| Slow `publish()` rsync | all four steps with a fresh credential | **under 1 s.** Not it |
| A too-low ceiling | raised 300 → 600 → ~540 | hung every time. Not it |
| sudo credential expiry | keep-alive added (`sudo -v` every 45 s) | **still hung. NOT IT** |

Running the docs build and the publish by hand, back to back, completes in 10 s
end to end. Both halves work. Only the combination inside `deploy.sh` hangs.

**What has NOT been tried, and is the obvious next step.** Nobody has
instrumented `deploy.sh` ITSELF to find out which line blocks — whether it is
inside `npm run docs:build` or inside `publish()`. Every measurement so far was
taken OUTSIDE the failing context, which is exactly why they all came back
clean. Add per-line timestamps (or `set -x` with `PS4='+ $(date +%T) '`) and run
it; that answers in one attempt what three theories did not.

**Workaround, and it is a good one.** Run the docs build and publish by hand —
it takes ten seconds and is how the site was published on 2026-08-31:

```bash
cd ~/samo-projects/samomdkkuweb
DOCS_BASE=/docs/ npm run docs:build
sudo mkdir -p /var/www/docs/assets
sudo rsync -a docs/.vitepress/dist/assets/ /var/www/docs/assets/
sudo rsync -a --delete --exclude=assets/ docs/.vitepress/dist/ /var/www/docs/
sudo chown -R www-data:www-data /var/www/docs
```

**The general rules — these survive even though the diagnosis did not:**

1. **A process that stops at EXACTLY its timeout was not slow, it was blocked.**
   A genuinely slow job finishes at an arbitrary moment; only a stuck one lands
   on the round number. The second run, hitting the higher ceiling too, is the
   experiment that rules slowness out — read it that way instead of raising the
   ceiling a third time.
2. **Measuring a step OUTSIDE the context that fails proves nothing about it.**
   Every "not it" row above was measured standalone, and standalone is precisely
   the condition under which it works. Instrument the failing run.
3. **Do not write a root cause into this file until the fix is OBSERVED to
   work.** "Reintroduce the bug, watch it fail on the assertion you expect,
   restore" applies to diagnoses as much as to guards. A fix that ships
   unverified alongside a confident explanation converts a debugging problem
   into a misinformation problem.

---

## "After I login on the preview link, it navigates back to samo.md.kku.ac.th" — the redirect was the harmless half

**Symptom, as reported.** Signing in on a `*.samomdkkuweb.pages.dev` URL bounced
the user to production. Asked whether that was intentional.

**It was correct Supabase behaviour, and it was hiding something much worse.**

**Cause, traced in order.**

1. **There were no preview deployments at all.** Every Cloudflare deployment was
   `env=production, branch=main` — previews only build for NON-production
   branches, and no PR branch had been pushed. The "preview link" was a
   PRODUCTION deployment that merely had a preview-shaped URL.
2. **That deployment was wired to the real database.** Grepped from the served
   bundle, not assumed: `https://fheueuowbchsnsvbcgil.supabase.co`.
3. **`VITE_ENV_NAME` was unset on Cloudflare's production environment**, and
   `ribbonLabel(undefined, '<hash>.pages.dev')` returns `'PREVIEW'`. So the page
   displayed an orange PREVIEW ribbon while writing to live student data.
4. The reported bounce is the LAST link, not the fault: the prod allow-list has
   `https://samomdkkuweb.pages.dev/**`, which matches paths on that EXACT host
   and not a hash subdomain. Supabase rejected the return address and fell back
   to `site_url` — `https://samo.md.kku.ac.th`.

**The dangerous shape**: hand that link to a ฝ่าย member to "try it safely" and
their test PR request and VitalSound ticket are real. The instrument whose only
job is to say *this is not real* said the opposite, and only a cosmetic
redirect made anyone look.

⛔ **The fix NOT to make**, and it is the obvious one: adding
`https://*.samomdkkuweb.pages.dev/**` to the PRODUCTION allow-list. It removes
the symptom in one click and makes the cause permanent — sign-in against
production would then work on every hash URL for ever. **A symptom that is the
only reason anyone noticed is not the thing to remove.**

**Fix.** Cloudflare's PRODUCTION environment now carries the `samo-dev`
database and `VITE_ENV_NAME=preview`, exactly like its preview environment, so
NOTHING served from pages.dev can reach production data. Verified from the
served bundle after a rebuild (env-var changes only apply to NEW deployments —
the old ones keep their baked values). The reported redirect fixed itself: dev's
allow-list already carries `https://*.samomdkkuweb.pages.dev/**`.

Rejected: killing the production build entirely. It is stronger isolation, but
nothing would then be deployed at `samomdkkuweb.pages.dev`, and the retired-host
splash that forwards old bookmarks to the VM lives IN that deployment.

**Where it lives now.** `tools/repo-protection.mjs` asserts, for both
environments, that the database IS `SUPABASE_DEV_URL` and that `VITE_ENV_NAME`
is set and not `production`. Measured against `SUPABASE_DEV_URL` rather than a
hardcoded ref, which would rot the first time a project is recreated. Proved by
reintroducing all three variants — real database, label `production`, label
deleted — and watching each go red.

📌 **A trap found while proving it: Cloudflare PATCH MERGES `env_vars`.**
Omitting a key does not clear it, so the first attempt to reintroduce "unset"
silently changed nothing and the assertion stayed green — a ritual that proved
nothing while looking like it had. Send `null` to delete. **When a reintroduction
does not go red, suspect the reintroduction before trusting the guard.**

**The general rule.** **Ask what a deployment is WIRED TO, never what its URL
looks like.** A hostname, a ribbon and a branch name are all labels; the only
answer is the built artifact and the config that produced it. And when a
warning label and a data path disagree, the label is the thing that gets
believed — so guard the pairing, not either half.

---

## The deploy exited 0, published the app, and silently skipped `/docs` — after I had written up the hang as "not reproducing"

**Symptom.** `./server/deploy.sh` ran to completion, `ssh` returned **exit 0**,
and the app bundles were current. `/docs` was not. The served
`/docs/contributing` still carried text that had been corrected and pushed
hours earlier.

**How it was caught, and the only tell that works.** Not the exit code, not the
output. The write times of the three roots:

```
/var/www/samo-web   2026-08-31 14:35:12   ← this deploy
/var/www/passport   2026-08-31 14:35:19   ← this deploy
/var/www/docs       2026-08-31 12:22:12   ← a DIFFERENT, earlier deploy
```

The VM's own checkout had the correction (`grep` found it in the source), so
this was not a stale pull. The publish step simply never ran. The captured
output stops at `==> docs site: build with base /docs/` — the steps after it
(`fix permissions`, `restart notify`, `nginx reload`, `done`) never printed, and
neither did the `DEPLOY_EXIT=$?` line, meaning the remote command ended before
its own last statement while ssh still reported success.

**Cause: still not known.** What IS now known, and is the useful part:

- it is **intermittent** — two full runs earlier the same day completed the
  docs step and printed `==> done`;
- it can present as a **hang** (killed by hand, three times) **or as a clean
  exit 0** (this time). The failure mode is not stable, which is why every
  theory so far has been "confirmed" by a run that happened to work;
- ruled out by measurement: sudo expiry · a `timeout` ceiling below the real
  ~7-minute duration · the `ssh -tt` PTY (a control run streamed output the
  documented way and completed).

**Fix, for now.** Publish `/docs` by hand — ten seconds, commands in
`skills/deploy-vm.md` — and **verify by comparing root write times, never by
the exit code.**

**Where it lives now.** `STATE.md`'s deploy block carries the `stat` one-liner;
`skills/deploy-vm.md` carries the recurrence.

**The general rule — and I broke it myself, in writing, today.** After two clean
runs I recorded the hang as "NOT REPRODUCING" and told the owner to "treat
`deploy.sh` as working". I hedged that two clean runs are not a root cause, and
then wrote a conclusion that read like one anyway. **An intermittent fault is
not disproven by successes; it is only ever proven by a failure.** The honest
record for a flaky step is a count — how many runs, how many failed — never a
verdict. A green run tells you nothing about the next one.

**Corollary, and the reason this one bit:** *an exit code is a claim about the
process, not about the artefact.* This project already knew that — `STATE.md`
carried the words "one run exited 0 having published nothing" — and the check
that would have caught it in one second is comparing what is ON DISK to what was
supposed to be written. Verify the artefact, every time, even when the tool says
it succeeded.

## Six runs, four failures, no diagnosis — because the failing step's output was being thrown away at the observer

**Symptom.** `./server/deploy.sh` skipped the `/docs` publish on four of six
runs, presenting sometimes as a hang and sometimes as a clean exit 0. Three
theories were proposed and falsified. Every write-up of it ends with "cause not
yet found".

**Cause of the missing DIAGNOSIS** (the fault itself is still open). The command
in `skills/deploy-vm.md` ends:

```bash
… ./server/deploy.sh; echo "DEPLOY_EXIT=$?"' 2>&1 \
  | grep -viE 'password|^\[sudo' | grep -E "DEPLOY_EXIT|==>|error" | tail -12
```

That `grep -E` keeps the `==>` headings and discards **everything the failing
step said about itself** — vitepress's output, npm's error block, any stack
trace. The only copy of it went through that filter. So "nothing after
`==> docs site` has ever been observed" was never a fact about the run; it was a
fact about the *observer*. Six runs produced no evidence because nobody was ever
shown any.

Two more instruments were lying in the same direction:

- **`DEPLOY_EXIT=0` was documented as "the real verdict".** It is not — the
  script can publish the app, skip `/docs` and still reach its own last line.
  And its *absence* is not exit 0 either: the local pipeline's status belongs to
  `tail`, so a remote shell that died silently scores as success.
- **`BASH_LINENO` inside an EXIT trap** names the trap's call site, not the
  failing command. It printed `deploy.sh:1`. The failing line has to be captured
  when it fails — an `ERR` trap.

**Fix.** `deploy.sh` writes every run in full to `~/samo-deploy-logs` on the VM,
plus a timestamped xtrace (`BASH_XTRACEFD`, so stdout stays readable) naming
each line as it runs. Both are outside the filter, survive the ssh stream, and
survive the process being killed. An `EXIT` trap writes the verdict and
`HUP`/`INT`/`TERM` are trapped so a signal reaches it, which separates the two
shapes that looked identical from outside:

| The log ends with | It means |
|---|---|
| `<== exit 0 — ran to the end` | a real, complete run |
| `<== exit N at deploy.sh:<line>` | the script failed and said so |
| **no `<==` line at all** | killed outright — SIGKILL, the OOM killer, the channel dying. No trap ran |

**What the first instrumented run bought immediately, without even failing.**
A healthy deploy is **30 seconds**: `npm ci` 6 s + 3 s, the three builds 7 s +
1 s + 10 s, every rsync under a second. This file and `skills/deploy-vm.md` both
carried "a full deploy needs MORE than five minutes", inferred from a run that
`timeout 300` killed — *inside a step that takes ten seconds*. So the two
"clean ~7-minute runs" that the hang was declared not-reproducing on were **14×
baseline**: degraded runs that happened to finish, not controls. The tally is
7 runs / 3 published docs / 4 did not.

**Where it lives now.** `server/deploy.sh` (the logging block and the traps);
`skills/deploy-vm.md` (the tally, the per-step baseline, how to read the end of
a log). The duration has ONE home there — five other files were restating a
"~90 s" from the one-app era that a paragraph in that same file had already
corrected.

**The general rule, and it is not "add logging".** *An intermittent fault that
resists three theories is usually an evidence problem, not a hard problem.*
Before proposing a fourth cause, ask what the failing step is allowed to say and
who is listening — here, a `grep` in the invocation silently deleted the only
witness, and two of the three instruments left reported success by construction.
**A baseline is part of the evidence**: without "healthy = 30 s" there was no way
to see that the successful runs were sick too.

## The guard said "nothing on pages.dev reaches production" — it had only ever asked ONE of the three projects

**Symptom.** `node tools/repo-protection.mjs` reported **all 18 pass**, including
`Cloudflare production uses the DEV database`. The account actually held three
Pages projects, and two of them were wired elsewhere:

| Project | production `VITE_SUPABASE_URL` | `VITE_ENV_NAME` |
|---|---|---|
| `samomdkkuweb` | samo-dev ✓ | `preview` ✓ |
| **`refactorsamomdkkuweb`** | **the LIVE production project**, with a production anon key | **unset** |
| **`samomdkkupassport`** | the frozen OLD passport database | unset |

`refactorsamomdkkuweb` is the exact configuration the guard was written for on
2026-08-31 — production database, production anon key, `VITE_ENV_NAME` unset, so
`ribbonLabel` guesses "PREVIEW" from the `.pages.dev` hostname. It is a retired
project, but it is still connected to a branch: a push to `refactor/modular`
would have built and published a working app over live student data.

**Cause.** The check was written against `REPO_NAME` — the repository the guard
lives in. But the rule it encodes is *"**nothing** on pages.dev may reach the
production database"*, and that is a statement about the **account**. Asking one
project can only ever confirm the project you already fixed. Neither of the
other two is named anywhere in this repository, so nothing here could see them:
`refactorsamomdkkuweb` still builds this repository's PRE-MOVE path (a
`phuriphatma/…` slug GitHub redirects), and `samomdkkupassport` builds a
sibling repo.

**Fix.** The guard enumerates `/pages/projects` and asserts, for every project ×
{production, preview}, that `VITE_SUPABASE_URL` is unset or samo-dev and that
`VITE_ENV_NAME` is not `production` — 18 checks became 27, seven of them red.
`tools/cloudflare-pin-dev.mjs` (`npm run cf:pin-dev`, `CONFIRM=1` to write) is
the matching fix and enumerates the same way; all 27 green afterwards, verified
by re-reading the API rather than by trusting the PATCH.

**⚠️ What the repoint does NOT fix, and it is the owner's call.** Env vars apply
to the NEXT build. Deployments that already exist keep the URL compiled into
their bundle, and `<hash>.<project>.pages.dev` serves them directly — the splash
redirect on the apex host does not cover a per-deployment hostname. Measured:
`05dc3a2a.samomdkkupassport.pages.dev` returns 200 and its bundle still names
the frozen passport database. **Deleting a retired project is the only complete
fix**, and deleting is destructive.

**Where it lives now.** `tools/repo-protection.mjs` (the account-wide loop, with
the reason above it) and `tools/cloudflare-pin-dev.mjs`.

**The general rule — a restatement of "never write a guard from the same list
the code came from".** *A guard whose SUBJECT is a name can only ever check that
name.* When the rule says "nothing", "every" or "any", the guard must enumerate
the population from the authority that owns it — here the Cloudflare account,
not this repository. Ask what the sentence quantifies over, then ask who can
list that. **A green count is not coverage**: 18 passed while three of the
account's six environments were wrong.

---

## A deploy verified green, then the SERVED bundle did not contain the change — and neither did the local build

**Symptom.** `b31454d` deployed cleanly (`<== exit 0 — ran to the end`, three
web roots written within 18 s), but grepping `/var/www/samo-web/assets/` for a
Thai string the commit added returned nothing. The obvious reading was a failed
or stale deploy.

**Cause.** The string was a `PENDING` release note in `src/data/changelog.js`.
`PENDING` is `export`ed, but **no module imports it** — `src/js/changelog.js`
pulls `RELEASES, LATEST, AREAS, CHANGE_TYPES, LEVELS, MAJOR_STORY` and nothing
else. Rollup therefore tree-shakes `PENDING` out of every bundle. It is staging
for `npm run release`, which folds it into a version; until that happens it has
no browser surface by design. The deploy was correct and complete.

**What caught it.** The control, exactly as class 7 prescribes. A second string
known to ship already (`แจ้งเตือนแบบ Silent`, the live vs-staff checkbox label)
*also* greped 0 — so the instrument, not the deploy, was the variable. Building
locally and grepping `dist/` settled it: the string is absent there too, from
the very source that defines it. **The local build is the cheapest control
available for "is this string supposed to be in a bundle at all".**

**The trap underneath.** This commit's whole shipped surface was the `/notify`
Node service, which `samo-notify` runs straight out of the VM's git checkout
(`WorkingDirectory=/home/ubuntu/samo-projects/samomdkkuweb`) — not out of
`/var/www`. "Grep the served bundle" is the right ritual for a frontend change
and answers nothing for a server-side one; the verification there is the file in
that checkout plus `ExecMainStartTimestamp` falling after the pull.

**Where it lives now.** The ⚠️ on the ✅ DEPLOYED block in `STATE.md`, which now
says which surface a given commit actually ships to.

**The general rule — a new instance of "check the INSTRUMENT can see it".** The
class already knew a string behind a build-time flag is DELETED, not renamed.
**A tree-shaken export is the same deletion with no flag to notice**: an
`export` nothing imports is not in the build, so its absence proves nothing.
Before grepping an artifact for a string, ask whether that string ships AT ALL —
and ask which artifact the commit ships to, because a server-side change never
enters `/var/www`. Grep a known-shipping control beside it; when the control is
also missing, stop and fix the instrument.

---

## The preview would have bounced ITSELF to production — a host guard fixed in one repo and not its twin

**Symptom.** Reported as *"when i open samopassport i got SAMO Passport
ไม่ได้อยู่ในเวอร์ชันทดสอบนี้"* — the samoweb preview honestly says Passport is not
in this build. Following the recorded plan to fix that (STATE.md A3: push a
`preview` branch, then point the splash at it) would have produced a preview
that redirected itself to `/moved.html`, whose button goes to **production**. A
tester sent to dev to click around safely would have landed on the real site.

**Cause.** Every built passport entry tested `/\.pages\.dev$/i` — ANY pages.dev
host. Previews live on pages.dev too, so the guard could not tell the retired
production URL from a preview *of itself*. samoweb carries the identical guard
and narrowed it **twice on 2026-08-27** for exactly this reason, its comment
ending "do not relax it to `(^|\.)`". That fix never crossed the repo boundary.
Eight days, and it would have silently defeated the dev-server work it had
nothing to do with.

**Fix.** `/^samomdkkupassport\.pages\.dev$/i` in **all four** built entries —
`vite.config.js` builds index, dashboard, admin and scan, so fixing `index.html`
alone would have left three. Proved against seven hostnames: the retired host
and its uppercase form still bounce; `preview.*`, `<hash>.*`, the VM, localhost
and `evilsamomdkkupassport.pages.dev` (which the OLD regex also matched) do not.

**Where it lives now.** `samomdkkupassport` commit `9777a67`, and the assertion
in this repo's `tools/repo-protection.mjs`, which already reaches across for
branch protection. It reads the executable `.test(location.hostname)` lines, not
the file text — the fixed `index.html` QUOTES the old regex in its explanatory
comment, so a substring check over the file would match the COMMENT and call a
correct file broken. It carries a control asserting it found a guard per entry,
and it was run BEFORE the fix and failed on all four.

**The general rule — class 6, with the boundary that makes it invisible.** Two
implementations of one rule drift, and *a repository boundary hides the drift
completely*: `host-guard.test.js` checks BOTH entry files in this repo and can
never see the sibling. When a rule exists in a repo with no test runner, the
guard belongs in the repo that HAS one, asserted over the API. **Ask which other
repository implements a rule you just fixed** — the sibling here had no tests,
no CI and no guards at all, so nothing was ever going to tell anyone.

---

## "Delete this Cloudflare Pages project" is not one call — it is 952

**Symptom.** `DELETE /pages/projects/<name>` returned
`success: false`, code 8000076: *"Your project has too many deployments to be
deleted."* The project had accumulated **952 deployments** over its life.

**Cause.** Cloudflare will not delete a Pages project while deployments exist.
Each must be deleted first, individually — there is no bulk endpoint. Two
smaller traps sat inside that:

- **`per_page=100` is rejected** with code 8000024, "Invalid list options". The
  deployments endpoint caps lower; `per_page=25` works. A naive pager gets
  `result: null` and, if it does `len(result)`, crashes — or worse, reads the
  null as "no more pages" and reports **0 deployments to delete** on a project
  holding 952. That near-miss is why this is written down: the count was wrong
  in the safe direction only by luck.
- **The active production deployment cannot be deleted individually** — it fails
  with exactly that message even with `?force=true`. That is not an error to
  chase: delete the other 951, and the PROJECT delete then succeeds and takes
  the last one with it.

**Fix.** Page with `per_page=25`, collect ids, `DELETE` each with `?force=true`
at low concurrency (4 was ample; 952 took about three minutes and stayed well
inside the 1200-per-5-minutes account limit), tolerate the one production
failure, then delete the project.

**Where it lives now.** Done once, 2026-09-04, for `refactorsamomdkkuweb`. No
script was kept — deleting a Pages project is rare and a retained bulk-delete
tool aimed at a project name is a loaded gun (`house0116`: a proof whose subject
is a hardcoded name that rotted). The recipe above is enough to rebuild it.

**The general rule.** *A destructive operation that looks like one API call can
be a thousand, and the failure that tells you so arrives only when you try it.*
Budget for it before promising the cleanup is quick — and when a paging loop
returns `null`, treat that as UNKNOWN, never as zero. A sweep that finds nothing
must prove it looked.

---

## A subpath in `DOMAIN` re-prefixes the routes INSIDE the container too — the healthcheck reported unhealthy while the service was fine

**Symptom.** Vaultwarden mounted at `https://samo.md.kku.ac.th/vault/` answered
correctly through nginx, but `curl http://127.0.0.1:8788/alive` on the VM
returned **404** and the container's own healthcheck — written against `/alive` —
kept it in `health: starting` and then unhealthy. Everything a user could reach
worked; the instrument said it was broken.

**Cause.** `DOMAIN=https://…/vault/` does not only tell Vaultwarden how to write
links. It re-mounts every route under that prefix, **including inside the
container**. So the real endpoint was `127.0.0.1:8788/vault/alive`. The subpath
is therefore stated in THREE homes — the nginx `location`, `DOMAIN`, and the
healthcheck URL — and only two of them had been updated.

The same shape produced two more failures in the same install:

- **`ORG_CREATION_USERS=admin` is not a value.** That setting takes `all`,
  `none`, or a comma-separated list of **email addresses**. Vaultwarden
  validates its entire config on load and **exits 12**, so a wrong value is a
  crash loop, not a warning — three restarts before `docker logs` was read.
  The log names the offending key exactly; read it before theorising.
- **`vaultwarden hash` reads `/dev/tty`.** Piping into it fails with
  `Os { code: 6 }` ENXIO, and so does `docker run -i` alone — it needs a pty on
  the HOST (`script -qec …`) *and* a tty in the CONTAINER (`-t`). The panic
  names a device error, which reads like a broken image rather than a missing
  terminal.

**Fix.** Healthcheck moved to `/vault/alive`;
`server/vaultwarden/vault-config.test.js` asserts the nginx `location` prefix and
`DOMAIN`'s path agree, so the two homes it *can* see cannot drift silently. The
`ORG_CREATION_USERS` and TTY traps are recorded in `skills/vaultwarden.md` beside
the commands that hit them.

**Where it lives now.** `server/vaultwarden/docker-compose.yml` (healthcheck with
the reason in a comment), `vault-config.test.js`, `skills/vaultwarden.md`.

**The general rule.** *A path prefix is a fact with as many homes as there are
things that speak the path — the proxy, the app's own config, and every probe.*
Enumerate the probes too: a healthcheck, a smoke test and a monitor are readers
of that fact exactly like the router is, and they are the ones that fail
CONFUSINGLY, reporting the service broken when only the instrument moved. When a
service answers correctly to users but its own health probe disagrees, suspect
the probe's URL before the service.

---

## Compose v2 ate every `$` in the argon2 admin token, and the app downgraded itself to plain text instead of failing

**Symptom.** The Vaultwarden admin panel refused the correct password. The env
file plainly contained `ADMIN_TOKEN=$argon2id$v=19$m=19456,...` and the server
log said, of that same value, **"You are using a plain text `ADMIN_TOKEN` which
is insecure."** File and application disagreed about what the file said.

**Cause.** **Docker Compose v2 performs variable interpolation on `env_file`
values** (measured on 2.40.3). `$argon2id` resolved to an undefined variable and
vanished, `$v=19` became `=19`, and so on:

| | length | starts | `$` count |
|---|---|---|---|
| the file | 118 | `$argon2id$` | 5 |
| **the container** | **72** | **`=19=19456,`** | **0** |

Vaultwarden then saw a string that did not begin with `$argon2`, concluded it
was a plain-text token, and compared it literally — so the real password could
never match. **It degraded instead of failing**, which is why this presented as
"wrong password" rather than "bad config".

The comment in our own `docker-compose.yml` asserted the opposite — that
`env_file` values pass through literally. That was true of Compose v1. Writing
the reassurance down made it *less* likely anyone would check.

**Fix.** Every literal `$` in `vaultwarden.env` is written `$$`. The token was
regenerated rather than repaired, because the mangled value had been the live
admin credential. Verified against the RUNNING container, not the file:
`docker exec vaultwarden printenv ADMIN_TOKEN` → 118 chars, `$argon2id$`, 5 `$`;
zero plain-text warnings; admin login `200`.

**Where it lives now.** `server/vaultwarden/docker-compose.yml` and
`vaultwarden.env.example` (both comments corrected, with the verify command),
`skills/vaultwarden.md`.

**The general rule.** *A config value is not what the file says — it is what the
process received.* Anything between the two (Compose interpolation, a shell, an
init system, a templating layer) may rewrite it, and the rewrite is invisible
from either end. Read the value back out of the RUNNING process. And note the
shape of the failure: the application did not reject the mangled input, it
QUIETLY ACCEPTED A WEAKER FORM of it — a security control that downgrades on
malformed input fails silently by design, so the log line saying so is the only
witness. Grep the logs after changing a credential, not just the behaviour.

---

## `.mjs` served as `application/octet-stream` — the in-browser e-sign button was dead from the day it shipped

**Symptom**: the professor's **ลงนาม** button on a หนังสือโครงการ opens its
modal, spins, then shows an English error. Nobody reported it; it surfaced only
while investigating why three หนังสือ were อนุมัติแล้ว with no signature. The
database settles it: `logSignToDoc` stamps `[e-sign]` into the doc timeline for
that path, and **the number of e-sign events in the entire production history is
zero**. All 18 signatures ever recorded were uploaded by hand.

**Cause**: `pdfjs-dist/build/pdf.worker.min.mjs?url` is the only `.mjs` Vite
emits. This box's `mime.types` has no entry for `.mjs`, so nginx fell through to
`default_type application/octet-stream`, and browsers **refuse a module script
served with a non-JavaScript type**. pdf.js 4.10 loads it as
`new Worker(url, {type:'module'})`, and its fallback is
`import(this.workerSrc)` — the SAME blocked URL — so `getDocument()` rejects and
the modal shows `Setting up fake worker failed: …`.

Measured on production 2026-09-09, in a real browser, with a control:

```
module worker (.mjs) : ERROR: worker error
dynamic import (.mjs): IMPORT FAIL: Failed to fetch dynamically imported module
CONTROL (.js worker) : ERROR: Uncaught ReferenceError: document is not defined
```

The control is the whole point — the `.js` worker **loaded and executed** (it
got far enough to throw a real error inside the worker); the `.mjs` one never
loaded. A deny-only probe could not have told those apart.

**Why nothing caught it.** `npm run build` is green — the file is emitted
correctly. `npm test` is green — nothing in the repo is wrong. `vite dev` and
`vite preview` both serve `.mjs` as JavaScript, so it works on every developer
machine and fails only on the VM. And `smoke-browser.mjs` loads the logged-out
landing page, which never touches a module only the professor's modal pulls in.
The fault lives BETWEEN the build and the host.

**Fix**: a regex location above `location /assets/` in `server/nginx-samo.conf`
with `default_type application/javascript`, restating `Cache-Control` because a
regex location wins over the prefix one. `default_type` and not a `types` block:
a `types` block at server or location level REPLACES the inherited map rather
than extending it. `application/javascript` is already in
`gzip_types`/`brotli_types`, so the 1.3 MB worker also stops shipping raw.

**Where it lives now**: `server/nginx-samo.conf` · `tools/asset-mime-check.mjs`
(`npm run check:asset-mime -- <url>`), which crawls the served HTML through its
chunks — the worker is three hops down, so no shallower crawl reaches it — HEADs
every `/assets/*.{js,mjs}` and asserts a JavaScript Content-Type. Its control is
that the run FAILS unless it actually checked at least one `.js` AND one `.mjs`,
so an empty crawl or a renamed directory can never print the same verdict as a
healthy site. A path that 404s is IGNORED, not failed: pdf.js carries a literal
`/assets/pdf.worker.mjs` that is never emitted, and going red on that would make
the check red for a reason it cannot diagnose.

**The general rule.** *A build artefact is not shipped until the HOST agrees
what it is.* Content-Type is part of the contract for anything the browser loads
as a module — a worker, a dynamic import, an ES module script — and the dev
server is not evidence, because it maps extensions the production host has never
heard of. When you add a dependency that emits a NEW file extension, ask what
the server will call it. And the failure is silent by construction: the browser
refuses the script without a network error, so the feature is simply absent.
