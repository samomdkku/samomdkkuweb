# Driving the app in a real browser

The Chrome extension (`mcp__claude-in-chrome__*`) is **usually not connected** in
this repo's sessions. Drive the app yourself instead. This has found bugs nothing
else could — the dead ยกเลิก button in every confirm dialog, and the iPad
portrait that no DOM measurement could see.

Two engines, and you need both:

| Engine | Use it for | How |
|---|---|---|
| **Chrome** (headless, CDP) | everything by default | Node 22's global `WebSocket`, no dependency |
| **WebKit** (Playwright) | anything the owner reports on **iPad/iPhone/Safari** | `npx playwright install webkit` |

---

## 1. Chrome over CDP — no dependencies

Node 22 has a global `WebSocket`, so a driver is ~40 lines and needs nothing
installed. Launch Chrome with `--headless=new --remote-debugging-port=PORT`, poll
`http://127.0.0.1:PORT/json/version` for `webSocketDebuggerUrl`, then
`Target.createTarget` → `Target.attachToTarget` → `Page.enable` +
`Runtime.enable`, and evaluate with
`Runtime.evaluate {expression, awaitPromise:true, returnByValue:true}`.

Useful extras:

- `Emulation.setDeviceMetricsOverride {deviceScaleFactor:2}` — **retina**. Half
  the responsive-image bugs only appear at DPR 2.
- `Page.captureScreenshot {captureBeyondViewport:true, clip:{x,y,width,height,scale}}`
  — clip in PAGE coordinates (`rect.y + window.scrollY`), `scale:2` to read small
  Thai text.
- Collect `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` into an array
  and print it. "No console errors" is a real assertion.

### Reaching the page you want

The public SPA opens on the landing tab. To get to a tab:

```js
document.querySelector('[data-bs-target="#pills-about"]')?.click()
```

Then wait — this app lazy-imports (d3, esign, shop QR). 2–5 s per step, and
`await sleep()` after every click that triggers a dynamic import.

---

## 2. WebKit, when the report comes from an iPad

```bash
npx playwright install webkit          # ~1 min, cached in ~/Library/Caches/ms-playwright
```

```js
import { webkit, devices } from 'playwright';
const ctx = await (await webkit.launch()).newContext({ ...devices['iPad Pro 11'] });
```

This is the same engine as mobile Safari. It reproduced the foreignObject paint
bug exactly.

`await page.route('**lh3.googleusercontent.com/**', r => r.abort())` forces the
broken-image state deliberately, instead of waiting to see if the network fails.

---

## 3. THE IMPORTANT PART: pick an instrument that can see the bug

**`getBoundingClientRect()` cannot see a paint bug.** On the iPad portrait bug it
returned the CORRECT box for every variant, including the broken ones — layout
was right, only the compositing was wrong. Computed style said `position:
relative` and nothing looked out of place.

When something is visibly wrong but every measurement says fine, **measure the
pixels**:

1. Replace the subject with a solid, unmistakable colour
   (`canvas.toDataURL()` of a `#cc3333` rect) so it cannot be confused with the
   design.
2. Screenshot.
3. Decode with `pngjs` and find the bounding box of that colour.
4. Compare to what `getBoundingClientRect()` claims. **A mismatch is the bug.**

```js
const png = PNG.sync.read(readFileSync('shot.png'));
const dpr = png.width / (await page.evaluate('innerWidth'));   // ← do not forget
let x0=1e9,y0=1e9,n=0;
for (let y=0;y<png.height;y++) for (let x=0;x<png.width;x++){
  const i=(png.width*y+x)<<2;
  if (png.data[i]>150 && png.data[i+1]<90 && png.data[i+2]<90){ n++; if(x<x0)x0=x; if(y<y0)y0=y; }
}
```

Divide by `dpr` before comparing to CSS pixels.

### Isolate with a minimal page, one property at a time

Once the pixels disagree with the layout, do NOT bisect the app. Write a
standalone HTML file reproducing the structure (for the iPad bug: a
`<g transform="translate(300,200)">` over a `<foreignObject>`), expose a
`setVariant(cls)` hook, and loop over one property at a time measuring the
painted position. The answer arrives in one run and it is unambiguous:

```
overflow:hidden · aspect-ratio · display:grid · border-radius  →  312,214  ok
position:relative                                              →   12, 14  wrong
```

12,14 was 312−300, 214−200 — off by exactly the transform. Nothing else could
have named the culprit that precisely.

---

## 4. Always run a CONTROL

Headless environments intermittently have **no egress to
`lh3.googleusercontent.com`**. Portraits then fail to load and it looks like a
bug you just introduced.

The control: check whether an **already-shipped, untouched** view has the same
symptom, and whether a bare `new Image()` to the same URL loads. On one run the
existing รายการ view loaded 0/11 images and the raw probe errored — proving the
environment, not the code. Do this before reporting an image bug.

---

## 5. Verify against PRODUCTION, not just localhost

`npm run preview` serves `dist/` on `:4173`. Verify there while iterating, then
re-run the same script against `https://samo.md.kku.ac.th/` after deploying. The
VM builds its own asset hashes, so a localhost pass proves nothing about prod —
see `skills/deploy-vm.md`.

---

## 6. Housekeeping

Put drivers in the scratchpad, never in the repo. Kill Chrome and the preview
server when done:

```bash
pkill -f "vite preview"; pkill -f "remote-debugging-port=92"
```

Use a distinct `--remote-debugging-port` per concurrent driver; a stale Chrome on
the same port silently attaches you to the wrong browser.

---

## 7. Driving a GATED admin pane without signing in

`/admin#claude` needs a session and a permission, which is a lot of ceremony for
a layout question. Stub the network instead and the whole pane runs for real.

Write a throwaway `claude-harness.html` at the REPO ROOT (vite dev serves it;
delete it after — it must never be committed):

```html
<link rel="stylesheet" href="/src/admin.css">
<script src="…bootstrap.bundle.min.js"></script>
<div data-admin-pane="claude" class="harness"><!-- paste src/html/tab-*.html --></div>
<script>
window.__P = { /* real payload, dumped from the RPC via tools/db-query.mjs */ };
window.__modalOpens = 0;
const rf = window.fetch.bind(window);
window.fetch = async (u, o) => {                       // stub BEFORE any module loads
  const s = String(u?.url ?? u);
  if (s.includes('/rpc/get_claude_board'))
    return new Response(JSON.stringify(window.__P.board), { status: 200 });
  if (s.includes('/rest/v1/') || s.includes('/auth/v1/'))
    return new Response('[]', { status: 200 });
  return rf(u, o);
};
</script>
<script type="module">
  import { enterClaudeWorkspace } from '/src/js/claude/index.js';
  document.addEventListener('show.bs.modal', () => { window.__modalOpens++; });
  await enterClaudeWorkspace();
  window.__ready = true;
</script>
```

Dump the payload with a real RPC call under an impersonated JWT:
`select set_config('request.jwt.claims', json_build_object('sub', <uid>, 'role',
'authenticated')::text, true);` then `select public.get_claude_board();`.

⚠️ **Reproduce the pane's REAL ancestry, or the harness hides the bug.** The
first สถิติ harness (2026-08-29) dropped the pane into a bare `<div>`, so it
rendered **660 px wide inside a 1280 px viewport** — and the truncation that was
the entire finding was invisible at that width. The admin panes live in
`.workspace-shell > main.workspace-main > section[data-admin-pane]`, and
`.workspace-shell` is a `260px 1fr` grid: without a sidebar element the main
column is not the width it will be in production. Copy the ancestry from
`admin/index.html`, and sanity-check the rendered width before trusting
anything you see.

📌 **Dumping a payload from a gated RPC.** `analytics_overview()` refuses a bare
superuser call (`requires an admin grant`), so impersonate inside a transaction:

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','<uid>','role','authenticated')::text, true);
select set_config('role','authenticated', true);
select public.analytics_overview(30) as payload;
rollback;
```

**Never omit the `show.bs.modal` counter.** Regenerating the harness once
without it made every "opens no modal" case pass vacuously; only the ALLOW case
("a long press DOES open it") went red and exposed it.

### Two probes worth rebuilding — each found a bug nothing else could

**A. Touch gestures, with REAL touch events.** `Emulation.setDeviceMetricsOverride
{mobile:true}` + `Emulation.setTouchEmulationEnabled`, then
`Input.dispatchTouchEvent` (`touchStart` / `touchMove` / `touchEnd`; `touchPoints:
[]` on end). The gesture branches on `pointerType`, so emulating a mouse tests
the branch that never runs. Cases: tap → no modal · long press → modal · drag →
no modal · tap the week arrow after a drag → no modal.

- **Always assert the point HIT something first.** `document.elementFromPoint(x,y)`
  must name the expected element. Coordinates taken from a scrolled-away column
  rect landed on the hero panel and four cases passed vacuously.
- **Re-measure coordinates at the moment of use.** The app sets
  `scroll-behavior: smooth`, so `scrollIntoView()` returns before the scroll and
  anything read on the next line is stale. Use `window.scrollTo({behavior:'instant'})`
  and wait.
- **CDP `touchCancel` dispatches NO dom events** in headless Chrome. To test a
  `pointercancel` handler, dispatch `new PointerEvent('pointercancel',{bubbles:true})`.

**B. Painted-box overlap.** "It looks weird" is a geometry claim; answer it with
geometry. Collect `getBoundingClientRect()` for each layer and count intersections:

```js
const hit = (a,b) => a.l < b.r-0.5 && a.r > b.l+0.5 && a.t < b.b-0.5 && a.b > b.t+0.5;
```

with a CONTROL asserting all layers are actually on screen. This named the real
collision as rail-vs-SESSION-FRAME — reading the stylesheet said the rail (0–6px)
and the block (9px+) did not overlap, which was true and not the problem.

---

## 8. Probing a MODAL, and three ways this harness passed vacuously

All four learned in one session on `/admin#claude`, each after the probe had
already reported green.

**The stylesheet is `src/admin.css`, not `src/main.css`.** `claude.css` (and
every other admin pane's CSS) is `@import`ed by the ADMIN entry only. Point the
harness at the public one and the pane renders completely unstyled — no lane, no
hour height, no borders — and the probe reports zero overflow, which looks
exactly like a pass. **Assert the stylesheet applied as a CONTROL in every run**:
a computed `--claude-lane`, a `dashed` border, a real `--claude-hour-h`.

**A closed Bootstrap modal is `display: none`, so everything in it measures 0.**
`querySelectorAll` still finds the elements, so a count-based assertion passes
while every `getBoundingClientRect()` returns an empty box. Click the button that
opens it and `await sleep(600)` before measuring anything inside:

```js
await evaluate(`document.getElementById('claudeNewBooking').click()`);
```

**A collision probe cannot see "none of them exist".** An assertion of the shape
"no two labels overlap" returns zero collisions when zero labels are rendered.
That is exactly what happened when `overflow: hidden` on a parent clipped every
label away: the probe went green on the run that shipped the bug. **Pair every
"these do not collide" with "and there are N of them".**

**The ข้อตกลง modal opens by itself** on a device that has not seen the current
`TERMS_VERSION`, and it covers the grid in every screenshot. Dismiss it before
clipping:

```js
document.querySelectorAll('.modal.show').forEach((m) => {
  window.bootstrap.Modal.getInstance(m)?.hide(); m.style.display = 'none';
});
document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
document.body.classList.remove('modal-open');
```

### Shell gotcha that costs a run each time

Write the harness generator with a **quoted** heredoc (`<<'PY'`). Unquoted, the
shell performs command substitution on the backticks inside JS template literals
and the file comes out mangled — or the generator silently writes nothing. Pass
paths in through `os.environ` rather than interpolating them.

And `cd` inside a compound command changes the cwd for everything after it in
that call: `cd "$SCRATCH" && node tools/db-query.mjs …` resolves `tools/`
relative to the scratchpad and fails. Use absolute paths.

---

## 4. Signing the driver IN — and the two traps that eat an hour

Most of this app is behind auth, so a driver that cannot log in can only ever
see the public mirror. Both shortcuts you will reach for first do not work.

### Trap 1: you cannot inject a session into `localStorage` — against the REAL backend

Writing `sb-<ref>-auth-token` yourself and reloading looks right and silently
does nothing — the app boots signed-OUT, because the real auth server rejects a
token it did not issue. ⚠️ **Narrowed 2026-09-21:** it DOES work when every
Supabase request is answered by a stub — see §10. (supabase-js has changed that key's
encoding across versions; do not spend time reverse-engineering it.)

**What works: drive the app's own sign-in form.** It is the path a person uses,
so it also tests the thing you actually care about.

```js
await evalJs(`(() => {
  const m = document.getElementById('signinModal');
  window.bootstrap.Modal.getOrCreateInstance(m).show();
})()`);
await sleep(1200);
await evalJs(`(() => {
  document.getElementById('signinLoginUsername').value = 'probe';
  document.getElementById('signinLoginPassword').value = '…';
  document.getElementById('signinLoginForm')
    .dispatchEvent(new Event('submit', { cancelable: true }));
})()`);
await sleep(7000);   // auth + profile + team sync + first data load
```

### Trap 2: a grant written straight into `public.users` is ERASED on login

`buildCurrentUser()` calls the `sync_my_team_permissions` RPC on **every**
login, and it OVERWRITES `managed_permissions`, `managed_vs_depts` and
`managed_project_seats` from the ทีม SAMO tree. So this:

```sql
update public.users set managed_project_seats = array['staff'] where email = …;
```

survives exactly until the probe logs in, at which point the tree says "this
person holds nothing" and the columns go back to `{}`. The symptom is a signed-in
account whose sidebar shows no workspaces, which reads as a broken gate.

⚠️ **"Erased on login" means the `managed_*` columns ONLY** — and the heading
above is the sloppy version of the sentence, so read this one.
`sync_my_team_permissions` does not touch `public.users.permissions`, which is
exactly why `tools/dev-grants.mjs` writes THAT column and not a `managed_*` one.
Flattening the two is how a session concludes that no hand-written grant can
survive a login, and abandons a working approach.

**The grant has to come from the tree.** Give the probe a `team_members` row:

```sql
select set_config('app.team_sync','1',true);   -- the columns are guarded
insert into public.team_members
  (node_id, kkumail, full_name, project_seat, permissions, inherit_permissions, position)
select n.id, 'probe@…', 'probe', 'staff', array['projects'], false, 999
  from public.team_nodes n order by n.id limit 1;
```

### The whole recipe, and cleaning up after it

1. `signUp` through the PUBLIC auth endpoint with the anon key — signup is open,
   so this needs no admin credential and creates a real account.
2. Insert the `team_members` row above for whatever seat/permission you are
   testing.
3. Drive the sign-in form, then assert on the SIDEBAR
   (`#adminSideNav [data-admin-side="x"]` not carrying `d-none`) before
   asserting on anything inside the pane — a hidden ancestor makes
   `getClientRects()` empty, so every inner check reads "missing" for the wrong
   reason.
4. **Delete it all afterwards**: the `team_members` row, the `public.people` row
   the registry mirror created for it, any feature rows it wrote, the
   `public.users` row, and the `auth.users` row. Then re-query to prove the
   probe is gone — and re-query the FEATURE for residue too (a probe that moved
   a real record must move it back).

This is worth the ~5 minutes: it is the only way to see a role-gated control
render for the role that is supposed to have it, and it caught that the
`ย้ายปีงบ` button correctly appears for a `staff` seat while `แก้ไขโครงการ`
(sender-only) correctly does not — a distinction no unit test in this repo can
make, because there is no DOM environment configured.

---

## 9. The STATIC RENDER — looking at markup without signing in

The cheapest useful check in this repo, and it found four bugs on 2026-09-02
that a green `npm test`, `npm run build` and a bundle-isolation check all
missed. Use it whenever the thing you changed is *drawn* rather than decided:
a diagram, a card grid, an editor row, a sandboxed block.

**The recipe.** Render the real function's output against the real BUILT
stylesheet, then screenshot it at desktop and phone width.

```bash
# 1. Get the fragment from the REAL renderer, not a copy. A throwaway vitest
#    file is the easiest way in — the modules import import.meta.env, so plain
#    `node` cannot load them.
cat > src/js/_probe.test.js <<'JS'
import { it } from 'vitest'; import { writeFileSync } from 'node:fs';
import { renderDeptContent } from './dept-content.js';
it('w', () => writeFileSync(process.env.OUT, renderDeptContent(rows)));
JS
OUT=/tmp/frag.html npx vitest run src/js/_probe.test.js

# 2. Build, then wrap the fragment in the SERVED stylesheet + the container
#    class the live page uses.
npm run build            # dist/assets/public-*.css
# 3. Serve and shoot at both widths.
python3 -m http.server 8098 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --disable-gpu --screenshot=/tmp/wide.png --window-size=1200,1400 \
  --hide-scrollbars "http://localhost:8098/_probe.html"
```

Then **delete `_probe.test.js` and the html** — a probe left behind is a test
that will fail on somebody else's machine.

### ⛔ The four traps, each paid for on the same day

1. **Load Bootstrap, or every layout looks broken.** `row`, `col-md-*`,
   `form-control`, `d-none` all come from the CDN (`admin/index.html` line 270),
   not from the built CSS. A probe without it showed hidden file inputs visible
   and every label overlapping its field — the PROBE was wrong, not the code.
   **Run the control first: does an already-shipped view have the same symptom?**
2. **`<meta charset="utf-8">`, or Thai renders as mojibake** and you spend ten
   minutes on an encoding bug that is in your harness.
3. **Pick the RIGHT stylesheet.** `dist/assets/` holds `public-*.css` AND
   `admin-*.css`. Grabbing `ls dist/assets/*.css | head -1` gets whichever sorts
   first, which is usually the wrong one.
4. **A sandboxed block inherits NOTHING.** To check a `kind='html'` row or a
   Lane-B tool, render it through `srcdoc` + `EMBED_SANDBOX` into a BLANK
   document — that is what the visitor gets. Anything that looked right because
   the surrounding page supplied it will disappear, which is the point.

### What it catches that a unit test cannot

Two shapes OVERLAPPING (a caption crossing a curve, a leader line struck through
text), a label wider than the box it is centred in, a panel a library opened on
the wrong tab, and dead space that grows with the window. jsdom has no layout
engine, so none of these are visible to `npm test` — and every one of them is
obvious in one look at a picture.

⚠️ **This does NOT replace signing in (§4).** It renders markup; it cannot
exercise a click handler, a permission gate, or anything that needs a session.
Use it to check what a thing LOOKS like, and §4 to check what it DOES.

---

## ⚠️ A FIXED `sleep` IN A MULTI-PAGE LOOP REPORTS HEALTHY PAGES AS DEAD

Measured 2026-09-04, verifying the passport merge on production. A driver walked
five pages in one loop with `await sleep(5000)` after each `Page.navigate`, and
reported `/admin/` as **0 nodes, `__samoBooted: false`, empty body** — the exact
signature of the "dead and animated" failure this repo has a write-up for.

`/admin/` was fine. Re-driven **alone**, it reached `booted=true` with 3,021
nodes in under 3 s, showing the correct signed-out gate. Nothing was wrong with
it at any point.

**The cause is the instrument.** The pages share one browser and one event loop;
by the fifth navigation the earlier pages' lazy imports were still settling, so
a timer that was generous for page one was not generous for page five. The
heaviest entry, measured last, looks broken.

**Do this instead** — poll for a signal rather than sleeping for a duration:

```js
for (const t of [3000, 5000, 7000]) { await sleep(t); /* re-read and print */ }
```

Three readings cost seconds and distinguish "not ready yet" from "never coming".
A single reading cannot. Better still, drive one page per browser when the
verdict matters.

**The general rule, and it is this repo's own**: *a warning that fires on the
healthy case is worse than no warning.* I nearly reported a working admin page
as a merge regression. Before believing a browser check's bad news, re-run that
ONE page in isolation — the second run costs a minute and is the difference
between a bug report and a false alarm.

---

## 10. Signed in with NO account at all — stub the whole backend over CDP (2026-09-21)

For a question about THE PAGE (does this button upload, does this panel render,
what request does it send), not about the database. Used to reproduce the shop
slip flow, the per-size price modal, the ระบบบ้าน mismatch panel and the admin
announcement editor.

1. `Fetch.enable` with patterns `*supabase.co/*` and `*script.google.com/*`;
   answer every `Fetch.requestPaused` with `Fetch.fulfillRequest` from a small
   `reply(request)` router (`/auth/v1/user` → a user object; `/rest/v1/users` →
   the profile row with the `role` you want; the table/RPC under test → your
   fixture; everything else `[]`). **Send CORS headers**
   (`Access-Control-Allow-Origin/Headers/Methods: *`) or the page sees a network
   error.
2. Load the page once, then write the session and reload:
   `localStorage.setItem('sb-<ref>-auth-token', JSON.stringify({access_token:<any
   JWT-shaped string with sub + exp>, refresh_token:'r', token_type:'bearer',
   expires_in:3600, expires_at:4102444800, user}))`. `<ref>` is from
   `SUPABASE_DEV_URL` — `npm run dev` points at samo-dev.
3. Drive it; to set a file input use `DOM.setFileInputFiles` on the node.
4. Assert on what the router RECEIVED (method, body), not only on the DOM.

Three traps, each hit once:
- **Every POST appears TWICE in a naive request log** — the first is the CORS
  `OPTIONS` preflight. Log the method before calling anything a double-submit.
- **A reused `--user-data-dir` keeps the session.** A "signed-out" pass measured
  the signed-in button until the script ran `localStorage.clear()` first.
- **A probe whose values differ from the stored ones can trigger the very write
  that hides a sync bug** (0200) — for DB-side proofs see
  `docs/mistakes/postgres-schema.md`.
