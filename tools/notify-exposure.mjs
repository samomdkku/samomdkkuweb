#!/usr/bin/env node
// ============================================================
// notify-exposure.mjs — can anything OUTSIDE the VM fire a real notification?
//
//   node tools/notify-exposure.mjs          (part of `npm run proofs`)
//
// WHY THIS EXISTS — 2026-08-27, twice in one hour.
// `functions/notify.js` runs on every Cloudflare Pages deployment, and
// Cloudflare BAKES ENV VARS IN AT DEPLOY TIME. So a deployment keeps whatever
// webhook URLs it was built with, for ever, at a URL that stays live — and
// `samomdkkuweb.pages.dev/notify` is a memorable address named in this repo's
// own public documentation. Two real messages reached a live ฝ่าย channel from
// hosts that were believed to be retired or already fixed.
//
// THE RULE THIS ENFORCES: the credentials that reach real people live ONLY on
// the VM (`server/samo-notify.env`). Cloudflare may hold the DEV webhook, on
// the preview environment of the one project that builds previews. Nowhere
// else, in any environment, on any deployment.
//
// ⚠️ NEVER TEST THIS BY SENDING. That is what caused both incidents. Reading a
// deployment's `env_vars` from the API is the authority; a POST is a live fire.
// If you must touch the endpoint, use a MALFORMED BODY — it returns
// "invalid JSON body" before any webhook is resolved.
// ============================================================

import { readFileSync, existsSync } from 'node:fs';

const SECRET_KEYS = ['DISCORD_PR_WEBHOOK', 'DISCORD_VS_WEBHOOKS', 'DISCORD_PROJECTS_WEBHOOK', 'GAS_WEBHOOK_URL'];
// The ONLY place Cloudflare is allowed to hold notify credentials: the preview
// environment of the project that actually builds previews, where they point at
// #samo-dev-bot rather than a real ฝ่าย channel.
const ALLOWED = new Set(['samomdkkuweb/preview']);

function env(k) {
  if (process.env[k]) return process.env[k];
  if (!existsSync('.env.local')) return '';
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === k) return line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return '';
}

const ACC = env('CLOUDFLARE_ACCOUNT_ID');
const TOK = env('CLOUDFLARE_API_TOKEN');
if (!ACC || !TOK) {
  console.log('✗ CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing from .env.local');
  console.log('\n1 FAILED');
  process.exit(1);
}

const api = async (path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}${path}`,
    { headers: { Authorization: `Bearer ${TOK}` } });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors || j).slice(0, 200));
  return j.result || [];
};

const findings = [];   // must be zero — these are fixable today
const historical = [];  // cannot be un-baked; reported, not failed
let checked = 0;

const projects = await api('/pages/projects');
for (const p of projects) {
  // 1. the PROJECT's stored config — what FUTURE builds would bake in. Fixable.
  for (const envName of ['production', 'preview']) {
    const vars = Object.keys((p.deployment_configs?.[envName] || {}).env_vars || {});
    const held = vars.filter((k) => SECRET_KEYS.includes(k));
    checked += 1;
    if (held.length && !ALLOWED.has(`${p.name}/${envName}`)) {
      findings.push(`${p.name} [${envName} CONFIG] holds ${held.join(', ')} — future builds would bake these in`);
    }
  }

  const deps = await api(`/pages/projects/${p.name}/deployments?per_page=25`);
  // 2. the deployment currently serving the project's own domain. Fixable by
  //    rebuilding, and it is the URL people actually know.
  const liveProd = deps.find((d) => d.environment === 'production');
  if (liveProd) {
    const held = Object.keys(liveProd.env_vars || {}).filter((k) => SECRET_KEYS.includes(k));
    checked += 1;
    if (held.length && !ALLOWED.has(`${p.name}/production`)) {
      findings.push(`${p.name} [LIVE production ${liveProd.id.slice(0, 8)}] ${p.subdomain} holds ${held.join(', ')} — rebuild after clearing the config`);
    }
  }

  // 3. everything older. A deployment's env is FROZEN at build time and cannot
  //    be changed, so this can only shrink by deleting deployments — or by
  //    rotating the credential, which makes every frozen copy inert. Counted,
  //    never failed: a guard that can never go green is a guard people learn to
  //    ignore (`.claude/rules/mistakes.md`).
  const old = deps.filter((d) => d !== liveProd
    && Object.keys(d.env_vars || {}).some((k) => SECRET_KEYS.includes(k))
    && !ALLOWED.has(`${p.name}/${d.environment}`));
  checked += deps.length;
  if (old.length) historical.push(`${p.name}: ${old.length}+ historical deployments carry frozen notify credentials`);
}

for (const f of findings) console.log(`✗ ${f}`);
for (const h of historical) console.log(`… ${h}`);
console.log(`\nchecked ${checked} configs and deployments across ${projects.length} Pages projects`);

if (historical.length) {
  console.log('\nNOTE — the historical tail is NOT a failure and cannot be fixed in place.');
  console.log('  A deployment keeps the env it was BUILT with, for ever, at a live URL.');
  console.log('  The only things that neutralise it: ROTATE the webhook (every frozen');
  console.log('  copy becomes inert instantly), or delete the deployments.');
}
if (findings.length) {
  console.log(`\n${findings.length} FAILED`);
  console.log('  Fix the CONFIG, then REBUILD — clearing config alone changes nothing');
  console.log('  for what is already deployed. Never verify by sending: use');
  console.log('  `npm run webhook:id <url>` to see where a webhook points.');
  process.exit(1);
}
console.log('all pass — no project config or live deployment can reach a real channel');
