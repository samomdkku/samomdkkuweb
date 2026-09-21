// ==============================================
// /notify — Cloudflare Pages Function: one Discord proxy for the whole app
//
// Replaces the GAS Discord path for PR, Vital Sign, and หนังสือโครงการ.
// Why a Pages Function instead of GAS:
//   - Runs on Cloudflare's egress (NOT GAS's heavily-shared IP) so the
//     Cloudflare per-IP 1015 rate limit that plagued the GAS path
//     effectively goes away for our volume.
//   - Real logs (GAS Cloud Logs are invisible for public-fetch calls).
//   - Webhook URLs live in Pages env vars, never in the bundle.
//
// GAS still owns Drive uploads + the projects email — only Discord moved.
//
// Observability: every delivery outcome is also appended (best-effort) to
// the `notify_log` table (migration 0055) so dropped notifications are
// diagnosable after the fact — the console logs below are live-tail only
// and retain nothing. That write needs two extra Pages env vars,
// SUPABASE_URL + SUPABASE_ANON_KEY (same values as the VITE_ ones); if
// they're unset the Function skips logging and behaves exactly as before.
//
// Contract (mirrors the old GAS createResponse): always HTTP 200 with a
// `success` boolean for app-level outcomes; 400 only for an unparseable
// body. The frontend `callGAS` in discord-queue.js already reads this
// shape (success:false / non-2xx both log).
//
// Request:  POST /notify   body = { action, ...payload }   (text/plain ok)
// Actions:  notifyPROnly | notifyVSOnly | notifyVSConsult | notifyProjectDiscord
//           | notifyClaudeBooking | notifyClaudeAlert | notifyClaudeMonitor
//           | notifyShopOrder (reads the order from the DB — see _discord.js)
// ==============================================

import { resolveTarget, postToDiscord, logNotifyOutcome, loadShopOrderForNotify } from './_discord.js';

/** Orders already announced by THIS process — a buyer re-posting their own
 *  order id must not post it twice. In-memory is enough: loadShopOrderForNotify
 *  also refuses anything older than 30 min, so a restart re-opens at most that
 *  window, once. */
const announcedShopOrders = new Map();

/** Coarse system tag for the notify_log row (migration 0055). */
function systemForAction(action) {
  if (action === 'notifyPROnly') return 'pr';
  if (action === 'notifyVSOnly' || action === 'notifyVSConsult') return 'vs';
  if (action === 'notifyProjectDiscord') return 'projects';
  if (action === 'notifyClaudeBooking' || action === 'notifyClaudeAlert'
      || action === 'notifyClaudeMonitor') return 'claude';
  if (action === 'notifyShopOrder') return 'shop';
  return null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let data;
  try {
    // The frontend sends Content-Type: text/plain (a CORS "simple
    // request"); read raw text and parse so content-type doesn't matter.
    data = JSON.parse(await request.text());
  } catch {
    return json({ success: false, message: 'invalid JSON body' }, 400);
  }

  const action = data && data.action;
  if (action === 'notifyShopOrder') {
    delete data.__shop; // only ever set from the database, below
    const key = String(data.orderId || '');
    if (announcedShopOrders.has(key)) return json({ success: true, duplicate: true });
    // Claimed BEFORE the await, so two concurrent posts of one id cannot both
    // pass the check; released again on any failure so a retry can deliver.
    announcedShopOrders.set(key, Date.now());
    const loaded = await loadShopOrderForNotify(env, data, context.fetchImpl ? { fetchImpl: context.fetchImpl } : {});
    if (loaded.error) { announcedShopOrders.delete(key); return json({ success: false, message: loaded.error }); }
    for (const [k, t] of announcedShopOrders) if (Date.now() - t > 60 * 60 * 1000) announcedShopOrders.delete(k);
    data.__shop = loaded;
    delete data.accessToken; // never logged, never forwarded
  }
  const { url, payload, error } = resolveTarget(action, data, env);
  if ((error || !url) && action === 'notifyShopOrder') announcedShopOrders.delete(String(data.orderId || ''));
  if (error) return json({ success: false, message: error });
  if (!url) {
    console.warn(`[notify] no webhook configured for action "${action}" (dept="${data.department || data.notifyTo || ''}")`);
    return json({ success: false, message: `no webhook configured for action "${action}"` });
  }

  const res = await postToDiscord(url, payload);

  // Durable outcome log (best-effort — migration 0055). Scheduled via
  // waitUntil so it adds no latency to this response AND still completes
  // if the fire-and-forget client has already navigated away by the time
  // delivery finishes. No-ops when SUPABASE_* env vars are unset.
  const logPromise = logNotifyOutcome(env, {
    system: systemForAction(action),
    action,
    ticketId: data.ticketId || data.orderId,
    dept: data.department || data.notifyTo || null,
    ok: res.ok,
    status: res.status,
    firstStatus: res.firstStatus ?? null,
    attempts: res.attempts,
    retried: !!res.retried,
    error: res.ok ? null : res.body,
  });
  if (typeof context.waitUntil === 'function') context.waitUntil(logPromise);
  else logPromise.catch(() => {});

  if (!res.ok) {
    if (action === 'notifyShopOrder') announcedShopOrders.delete(String(data.orderId || ''));
    console.warn(`[notify] ${action} → Discord HTTP ${res.status} after ${res.attempts} attempt(s)`, res.body || '');
    return json({
      success: false,
      message: `discord HTTP ${res.status}`,
      status: res.status,
      body: res.body,
      attempts: res.attempts,
      firstStatus: res.firstStatus ?? null,
      retried: !!res.retried,
    });
  }
  if (res.retried) {
    console.info(`[notify] ${action} delivered after ${res.attempts} attempt(s) (first status ${res.firstStatus})`);
  }
  return json({
    success: true,
    status: res.status,
    attempts: res.attempts,
    retried: !!res.retried,
    firstStatus: res.firstStatus ?? null,
  });
}
