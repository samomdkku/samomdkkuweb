# Skill — the `/notify` Discord notification service

⛔ **CLOUDFLARE PAGES IS RETIRED — this skill's TITLE and hosting are stale, its
CODE pointers are not.** Corrected 2026-09-13 rather than rewritten, because the
handler really is unchanged.

- **Where it runs now:** `server/notify-server.mjs` on the KKU VM, as the
  systemd unit `samo-notify`, reached through nginx's `location = /notify`.
  It imports `functions/notify.js`'s `onRequestPost` **unmodified** — so every
  code pointer below is still right, and `functions/` is still the one home for
  the builders and the router.
- **Where the webhook URLs live now:** `/etc/samo-notify.env` on the VM (root,
  `0600`). ⛔ **NOT in the Cloudflare dashboard** — env vars set there reach
  nothing, so a secret "stored" in it is lost, not stored
  (`.claude/rules/security.md`).
- **`appscript/vssound.gs` DOES NOT EXIST.** It was deleted in `9686bb2` when
  Discord moved off GAS, and this file still told you to assemble
  `DISCORD_VS_WEBHOOKS` from its `WEBHOOK_MAP`. The live values are in
  `/etc/samo-notify.env`; `appscript/` holds only `prform.gs` now.
- Reading a secret env file without printing it: `server/check-env-file.sh`.


All Discord notifications (PR, Vital Sign, หนังสือโครงการ) are proxied by a
single Cloudflare Pages Function instead of GAS. GAS still owns Drive uploads
and the projects email — only Discord moved.

- Function code: `functions/notify.js` (handler) + `functions/_discord.js`
  (pure builders/router/poster, unit-tested in `functions/notify.test.js`).
- Frontend posts `{ action, ...payload }` to `NOTIFY_FN_URL` (`/notify`,
  `src/js/config.js`) through the shared queue (`src/js/discord-queue.js`).
- Why: Cloudflare egress IP (not GAS's shared IP) ≈ removes the Cloudflare
  1015 per-IP rate limit; real logs; webhook URLs stay server-side.

## Environment variables (set per Cloudflare Pages project)

Pages → the project (`samomdkkuweb` for prod, `refactorsamomdkkuweb` for
preview) → Settings → Environment variables → add for **Production** (and
**Preview** if you want PR-branch deploys to fire):

| Var | Value source |
|---|---|
| `DISCORD_PR_WEBHOOK` | PR-team webhook (was `DISCORD_WEBHOOK_URL` const in `appscript/prform.gs`) |
| `DISCORD_PROJECTS_WEBHOOK` | projects/VPA webhook (was GAS Script Property `PROJECT_DISCORD_WEBHOOK_URL`) |
| `DISCORD_VS_WEBHOOKS` | **JSON** map `{ "<dept>": "<webhook>", ... }` incl. `"SE"` — read from `/etc/samo-notify.env` on the VM — `appscript/vssound.gs` was DELETED in `9686bb2` |

`DISCORD_VS_WEBHOOKS` shape (keys are the exact Thai dept strings + `SE`):

```json
{ "SE": "https://discord.com/api/webhooks/...", "อุปนายกฝ่ายวิชาการ": "https://discord.com/api/webhooks/...", ... }
```

After saving env vars, trigger a redeploy (Deployments → Retry, or push a
commit) so the Function picks them up. Env var changes alone do **not**
hot-reload an existing deployment.

### Automate it — `tools/set-notify-secrets.mjs`

Instead of clicking through the dashboard, push all three as encrypted
secrets (production + preview) in one call. Put these in `.env.local`
(gitignored): `CLOUDFLARE_API_TOKEN` (Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`,
`NOTIFY_DISCORD_PR_WEBHOOK`, `NOTIFY_DISCORD_PROJECTS_WEBHOOK`,
`NOTIFY_DISCORD_VS_WEBHOOKS` (the JSON map). Then:

```bash
node tools/set-notify-secrets.mjs --project refactorsamomdkkuweb            # dry run (masked)
CONFIRM=1 node tools/set-notify-secrets.mjs --project refactorsamomdkkuweb  # apply (preview)
CONFIRM=1 node tools/set-notify-secrets.mjs --project samomdkkuweb          # apply (prod)
```

Use FRESH (rotated) webhook URLs in `.env.local`, not the leaked ones. Still
trigger a redeploy after — env-var changes apply to the next deployment.

## Rotate the webhooks when you do this

The current webhook URLs (PR const + the VS webhooks, now only in `/etc/samo-notify.env`)
were exposed in chat/repo history. When migrating, regenerate them in
Discord → Server Settings → Integrations → Webhooks → Edit → Copy new URL,
and paste the **fresh** URLs into the Cloudflare env vars (not the old ones).
Then the old `.gs` copies are dead.

## Testing

- Unit: `npm test` (covers builders, per-dept routing, retry/1015 bail,
  handler outcomes — no network, fetch is injected/stubbed).
- Live on preview: push to `refactor/modular` → `refactorsamomdkkuweb.pages.dev`,
  set the env vars on that project, submit a PR/VS ticket or do a
  หนังสือโครงการ action, confirm the Discord message lands and check the
  Function logs (Pages → project → Functions / Logs, or `wrangler pages
  deployment tail`). Then merge to `main` for prod.

## Gotchas

- The frontend sends `Content-Type: text/plain` (a CORS simple request) —
  the handler reads `request.text()` then `JSON.parse`, so content-type
  doesn't matter and there's no preflight. Same-origin, so no CORS headers.
- Function returns HTTP 200 + `{ success }` for app-level outcomes (mirrors
  the old GAS contract `callGAS` expects); 400 only for an unparseable body.
- `functions/` lives at the repo root, separate from the Vite `dist/` build —
  Cloudflare Pages picks it up automatically; `npm run build` doesn't touch it.
- The GAS notify actions (`notifyPROnly`, `notifyVSOnly`, `notifyVSConsult`,
  `notifyProjectDiscord`) are now dead code — safe to delete from the `.gs`
  on the next GAS redeploy, but harmless if left.
