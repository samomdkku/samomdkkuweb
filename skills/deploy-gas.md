---
name: deploy-gas
description: Redeploy the slim Apps Script file (Drive upload + projects email). Required after any edit to appscript/prform.gs.
---

# Deploy Apps Script changes

After editing `appscript/prform.gs`, the change must be deployed to the
Google Apps Script project. The `/exec` URL doesn't change between deployments.

> Discord notifications moved OFF GAS to the Cloudflare Pages Function
> `/notify` (see `skills/cloudflare-notify-function.md`). `vssound.gs` was
> deleted (it was Discord-only) and `prform.gs` no longer has any Discord
> code — GAS now only does Drive uploads + the projects email.

## Which project to deploy to

Only `prform.gs` remains. Deploy to the PROD "prform" GAS project (the legacy
"prform_dev" / the whole "vssound" project are no longer used).

⛔ **Do not copy a `/exec` URL out of this file — read it from
`src/js/config.js`, which is the one home.** The URL that used to be written
here (`AKfycbw1iHE4ALCO…`) was STALE and is not what the app calls; the live one
is `AKfycbwomKii…`. `tools/deploy-gas.mjs` derives both the endpoint to verify
and the deployment to roll from that file for exactly this reason, so a stale
copy here could only ever mislead a human doing it by hand — and probing the
wrong endpoint looks identical to a deploy that did nothing.

```bash
grep -A2 'export const GAS_API_URL' src/js/config.js
```

## Procedure — automated (preferred)

```bash
npm run deploy:gas
```

`tools/deploy-gas.mjs` does: pull the remote → **diff it against the repo** →
push → `create-version` → `update-deployment` on the EXISTING deployment →
probe the live `/exec` to prove the new code is serving.

Flags:

| flag | what it does |
|---|---|
| `--dry-run` | diff + report only; writes nothing |
| `--force` | proceed even though the remote has changes the repo does not |
| `--verify` | only probe the live endpoint (no auth or script id needed) |

### One-time setup (credentials — yours, not the agent's)

1. `npx clasp login` — opens a browser, writes `~/.clasprc.json`. **Never commit
   that file.** It is a Google OAuth credential for your whole account.
2. Turn on the Apps Script API for the *same* Google account:
   <https://script.google.com/home/usersettings> → "Apps Script API: ON".
   Without it every clasp call fails with *"User has not enabled the Apps Script
   API"*.
3. Add the script id to `.env.local` (gitignored):
   ```
   GAS_SCRIPT_ID=<Apps Script project → ⚙ Project Settings → IDs → Script ID>
   ```
   You do **not** need to set a deployment id: the script derives it from
   `GAS_API_URL` in `src/js/config.js`, whose path segment IS the deployment id.
   That matters here — this project has **three** deployments (one `@HEAD`, the
   live web app, and an old `@25` kept for rollback), so "pick the only non-HEAD
   one" would be ambiguous and rolling the wrong one looks exactly like the
   deploy having done nothing. Override only to deploy an endpoint config.js does
   not reference:
   ```
   GAS_DEPLOYMENT_ID=<Deploy → Manage deployments → the id in the URL>
   ```

### Why it works the way it does

- **It never runs `clasp deploy`.** That command (`create-deployment`) mints a
  NEW deployment with a NEW `/exec` URL. `GAS_API_URL` in `src/js/config.js` is
  hard-coded to the existing one, so a new deployment presents as "every upload
  silently fails". The script always does `create-version` +
  `update-deployment <same id>`, which is exactly the manual "Version: New
  version" step, so the URL never moves.
- **It diffs the remote first.** Anyone can edit the script in the browser.
  Pushing is a silent overwrite with no undo, so remote-only lines stop the
  deploy and print themselves; a full copy lands in `.gas-remote/` for
  `diff .gas-remote/<file> appscript/prform.gs`. `--force` proceeds.
- **It pushes from a staging dir (`.gas-build/`), not `appscript/`.** Two
  reasons: the manifest (`appsscript.json` — oauth scopes, web-app access,
  timezone) is round-tripped from the remote instead of being authored blind, so
  a deploy can't quietly change *who has access* or force every user to
  re-authorize; and the remote code file **keeps its existing name**, so pushing
  `prform.gs` into a project whose file is `Code.gs` doesn't delete and recreate
  it on every deploy.
- **It rolls the deployment named in `config.js`.** Same source of truth as the
  verification probe, so "what we deployed" and "what we tested" cannot diverge.
  It also checks that deployment actually belongs to `GAS_SCRIPT_ID`, so a stale
  config.js or wrong script id fails with a clear message instead of inside clasp.
- **It verifies over HTTP, not by trusting clasp.** See below.

### Rolling back

Versions are immutable, so a rollback is just pointing the deployment at an older
one:

```bash
cd .gas-build && npx clasp list-versions
npx clasp update-deployment <deploymentId> -V <oldVersion>
```

Then confirm with `npm run deploy:gas -- --verify` (which will now report OLD code
— that is the expected result of a deliberate rollback).

## Verifying the deploy worked

`npm run deploy:gas` does this automatically (retrying for ~15s, because GAS
takes a moment to swap the served version). To check by hand at any time:

```bash
npm run deploy:gas -- --verify
```

The canary is `uploadTeamFile` **with no `folderPath`** — the handler validates
that argument before touching Drive, so it proves the action exists while writing
nothing:

> **Only this exact input is inert.** The handler resolves (and CREATES) the
> folder before it reads `fileData`, so a probe that passes a *valid*
> `folderPath` will really create/move/rename folders in Drive — it just fails
> later, with a `fileData`-shaped error that looks identical. Don't reuse the
> canary shape with different arguments and assume it stayed harmless.


- `{"success":false,"message":"folderPath is required"}` → **NEW code is live**
- `{"success":false,"message":"Unknown action: uploadTeamFile"}` → **OLD code**;
  the version step didn't take

## Procedure — manual fallback

If clasp is unavailable (no auth, API toggle off, someone else's machine):

1. Open the "prform" Apps Script project at <https://script.google.com>
2. Open the main code file (usually `Code.gs` or similar)
3. ⌘A to select all → delete
4. Open `appscript/prform.gs` in this repo → ⌘A → ⌘C
5. Paste into Apps Script editor
6. ⌘S to save
7. **Deploy → Manage deployments → click pencil icon next to existing
   "API executable" / "Web app" deployment → Version: New version →
   Description (optional) → Deploy**
8. The "Deployment URL" remains the same. Verify with `--verify` above — step 7
   is the one people skip, and skipping it leaves the editor showing new code
   while `/exec` runs the old.

## Running a function remotely (`clasp run`)

Lets an agent invoke a NAMED function in the deployed script instead of you
clicking Run in the editor — used for the one-off Drive maintenance helpers
(`inspectDriveLayout`, `migrateDriveLayout`, `tidyScriptFiles`). The capability
is bounded by what functions exist in `prform.gs`, i.e. reviewed code in git.

**Be honest about the bound**: `scripts.run` mints a token carrying the
SCRIPT's OAuth scopes, and this script uses `DriveApp`, so that token can reach
the whole Drive. The limit is procedural (an agent calls named functions), not
technical. If you want a real boundary, put `IT Database` in a Shared Drive and
give automation an identity scoped to only that drive.

### Setup (one-time, yours — needs the Google Cloud console)

1. **Create or pick a standard GCP project** and configure its OAuth consent
   screen (Internal is fine). Note the **project number**.
2. **Attach it to the script**: Apps Script editor → ⚙ Project Settings →
   Google Cloud Platform (GCP) Project → *Change project* → paste the number.
   The default hidden project cannot be used for `clasp run`.
3. **Enable the Apps Script API** in that GCP project (APIs & Services →
   Library → "Apps Script API").
4. **Create a Desktop OAuth client** (APIs & Services → Credentials → Create
   credentials → OAuth client ID → Desktop app) and download the JSON.
5. `npx clasp login --creds <that.json>` — re-authorises with the script's own
   scopes. **The creds JSON and the resulting `~/.clasprc.json` are secrets**;
   see `.claude/rules/security.md`.
6. **Add an API Executable deployment**: Deploy → New deployment → type
   *API Executable* → Who has access: Only myself.

> **Step 6 is the one that looks like it violates the "never mint a new
> deployment" rule — it does not.** That rule is about the WEB APP deployment,
> whose id is baked into `GAS_API_URL`. An API Executable is a different entry
> point type; adding one leaves the web app deployment and its `/exec` URL
> untouched. It does mean `clasp list-deployments` now shows FOUR entries, so
> don't let that read as "someone re-deployed".

Then: `cd .gas-build && npx clasp run tidyScriptFiles`

### Gotchas

- **`clasp run` executes the deployed version, not your working copy.** Deploy
  first (`npm run deploy:gas`), then run — otherwise you are invoking old code
  and it looks like your change did nothing.
- **Adding a new Google service to `prform.gs` changes the auto-derived OAuth
  scopes.** The manifest has no explicit `oauthScopes`, so GAS derives them
  from the code. Adding `GmailApp`/`CalendarApp`/etc. would widen them and
  force a re-authorization — and this web app is `ANYONE_ANONYMOUS` +
  `USER_DEPLOYING`, so an unauthorised deployment means every upload fails.
  Staying within `DriveApp` + `MailApp` (already used) adds nothing.

## Where the folders live: `My Drive / IT Database`

Every folder the script touches is mounted under a single container folder,
`IT Database` (`APP_ROOT_FOLDER_NAME` in `prform.gs`) — previously they were
created straight in My Drive root and made the SAMO Drive unbrowsable:

```
My Drive/
  IT Database/
    PR/
    Projects/<slug>_PRJ-XXXX/<slug>_DOC-XXXXX/
    Shop/{Slips,Products,Banners,QR}/
    Team/<ปีการศึกษา>/<ฝ่าย>/
```

The frontend passes root-relative logical paths (`Shop/Slips/2026-05`);
the mount point is resolved server-side by `getOrCreateTopFolder_`, so no client
knows about `IT Database` and no stored URL changed.

**Migration is lazy + self-healing.** A top-level folder still sitting at My Drive
root is *moved* in on next touch, never recreated — a Drive move preserves the
folder id and every file id inside it, so URLs already in Postgres keep resolving.
To do all four at once instead of waiting for the next upload, run
`migrateDriveLayout` by hand from the Apps Script editor (Run ▸ migrateDriveLayout);
it is idempotent, is not routed through `doPost`, and creates nothing that doesn't
already exist.

Delete paths use `findTopFolder_` (non-creating) so trashing never materialises a
tree first. If you add a new top-level folder, resolve it through
`getOrCreateTopFolder_` — never `DriveApp.getRootFolder()` directly.

`Passport/{badges,certificates}` is written by the **passport** repo's own Apps
Script (`samopassport`) — a different project. That repo now has its own
`npm run deploy:gas` (a port of this one, reading `VITE_GAS_UPLOAD_URL` instead
of a committed config.js, with an inert `{action:'ping'}` canary). Deploying one
cannot affect the other.

## What `prform.gs` exposes

- `uploadPRFile`    action — base64-uploads an image to Drive `PR/`
- `uploadTeamFile`  action — base64-uploads to `Team/<nested path>`
  (allow-listed; lazily creates folders). ทีม SAMO member portraits, filed
  `Team/<ปีการศึกษา>/<ฝ่าย>/<ลำดับ>-<ชื่อ>.webp`. Doubles as the deploy canary.
- `uploadShopFile`  action — base64-uploads to `Shop/<nested path>`
  (allow-listed; lazily creates folders). Used by the SAMO Shop module
  for slips, product photos, and the PromptPay QR.
- `uploadProjectFile` / `deleteProjectFile` / `deleteProjectFolder` /
  `getProjectFolderInfo` — Drive ops for หนังสือโครงการ attachments
- `notifyProjectEmail` action — `MailApp.sendEmail` to uni_staff
- All Discord actions removed (moved to the `/notify` Cloudflare Function);
  all legacy actions removed (`submitPR`, `trackPR`, etc. — Supabase handles those)

## Verifying the deploy worked

In browser DevTools console after the deploy — a deliberately bad action
proves the new code is live without side effects:

```js
fetch('https://script.google.com/macros/s/AKfycbw1.../exec', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'notifyPROnly' })  // a removed action
}).then(r => r.text()).then(console.log);
```

- Returns `{"success":false,"message":"Unknown action: notifyPROnly"}`
  → NEW code is live (the Discord action is gone, as expected)
- Returns `{"success":true}` → OLD code still deployed (you forgot the
  "New version" step; the deleted Discord handler is still running)

## Where the logs DO and DON'T appear (read this before chasing "empty Logs")

`Logger.log` / `console.log` from `doPost` are **invisible** when the
Web App is called from an unauthenticated client — i.e. our frontend
`fetch(GAS_API_URL, { method: 'POST' })` calls without an `Authorization:
Bearer` header. The GAS "Executions" panel will list the run (with
duration + status) but the Cloud Logs section will say
*"No logs are available for this execution"* permanently — not a
propagation delay, the logs are never recorded.

This is a documented GAS rule for Web Apps deployed as
*Execute as: Me + Who has access: Anyone*:

| Caller is logged into Google? | GAS project shared with caller? | Logs visible? |
|---|---|---|
| No | No | ❌ |
| No | Yes | ❌ |
| Yes | No | ❌ |
| Yes | Yes | ✅ |

Or, for script/curl callers: logs appear only if an OAuth access token
is passed. The browser fetch with no Authorization header falls in
the "❌" rows.

**Workarounds when you need to debug:**

1. **Run the function manually from the Editor** (e.g.
   `testProjectDiscord()` in `prform.gs`) — Editor runs are owner-
   authenticated, so logs always appear.
2. **Add a temporary debug echo** — make the GAS handler return the
   debug data in the HTTP response. The frontend `dbRest` / `callGAS`
   logs the response body on failure, so the data lands in the
   browser console instead of GAS's hidden Cloud Logs.
3. **Link the GAS project to GCP** (Project Settings → Google Cloud
   Platform → Change project) — once linked, Stackdriver records
   every execution's logs regardless of who called. One-time setup.
   Not currently done for this project; worth doing if Discord /
   email reliability needs deeper diagnostics next time.

**Don't waste time** redeploying repeatedly to "make the logs appear"
when calls are coming from the public frontend. They won't.

## When NOT to redeploy

Don't redeploy during business hours / active campaign cycles unless the
change is critical. There's no rolling deploy — the old code is replaced
atomically.

## Why we don't `clasp push` the slim files

Apps Script's clasp CLI works but adds another auth surface to maintain.
For the size of edit traffic this project gets (~weekly tops), copy-paste
is honest.

## Two things that will make you think the deploy broke, and it did not

⚠️ **The `/exec` endpoint intermittently answers with an HTML page instead of
JSON** — Google's Thai *"ขออภัย ไม่สามารถเปิดไฟล์ได้ในเวลานี้"* / *"ไม่พบเพจ"*.
On 2026-09-10, four rapid POSTs in a row got it and the fifth, seconds later,
returned `HTTP 200` and correct JSON on the first try. It looks exactly like a
dead deployment. **Never conclude the endpoint is down from one probe** — retry
with a few seconds between calls, and note that `npm run deploy:gas -- --verify`
is a SINGLE probe, so it can report a healthy endpoint as broken.

⚠️ **`curl -L` cannot POST to `/exec`.** The redirect turns the POST into a GET
and you get Google's HTML page, every time — which reads as the same fault as
the intermittent one above. Use `fetch` from Node, or `curl` WITHOUT `-L`.

⚠️ **The first call after a redeploy carries a cold start**: 28 s for a
one-file request that takes under 2 s warm. Do not time anything, or set any
timeout, from that call.
