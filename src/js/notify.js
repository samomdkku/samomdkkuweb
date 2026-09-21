// ==============================================
// NOTIFY — Fire-and-forget Discord trigger for PR + Vital Sign
//
// All Discord notifications (PR, VS, and หนังสือโครงการ) now POST to ONE
// Cloudflare Pages Function (`/notify`, see functions/notify.js) through
// the shared rate-limit-aware queue in `discord-queue.js`. The Function
// builds the embed and routes to the right webhook (VS picks per-dept) —
// the frontend just sends { action, ...payload }. Running on Cloudflare's
// egress (not GAS's shared IP) is what removes the 1015 worry; the queue's
// minimum spacing prevents parallel POSTs on top of that.
//
// Usage (fire-and-forget — never await):
//   sendNotify('pr', { ticketId, ... });
//   sendNotify('vs', { mode: 'submit', ticketId, ... });
//   sendNotify('vs', { mode: 'consult', ticketId, ... });
// ==============================================

import { NOTIFY_FN_URL } from './config.js';
import { sendDiscord } from './discord-queue.js';

export function actionFor(system, mode) {
  if (system === 'pr') return 'notifyPROnly';
  if (system === 'vs' && mode === 'consult') return 'notifyVSConsult';
  if (system === 'vs') return 'notifyVSOnly';
  // จองโควตา Claude (0154). Its webhook URL lives in /etc/samo-notify.env on
  // the VM like every other one — NEVER in src/, which is served to browsers.
  //
  // ⚠️ THE MONITOR MODES MUST BE TESTED BEFORE THE CATCH-ALL BELOW, and the
  // failure if they are not is silent rather than loud: buildClaudeBookingPayload
  // reads `CLAUDE_MODES[data.mode] || CLAUDE_MODES.new`, so a monitor event that
  // reached it would render as a brand-new booking — right channel, wrong
  // meaning, no error anywhere. Order is the guard here (0167).
  if (system === 'claude' && (mode === 'monitor-on' || mode === 'monitor-off')) {
    return 'notifyClaudeMonitor';
  }
  if (system === 'claude') return 'notifyClaudeBooking';
  // ร้านค้า — a new order. The payload is only { orderId, accessToken }: the
  // server reads the order itself, as this buyer (functions/_discord.js).
  if (system === 'shop') return 'notifyShopOrder';
  throw new Error(`notify: unknown system "${system}" mode "${mode}"`);
}

export function sendNotify(system, payload = {}) {
  let action;
  try { action = actionFor(system, payload.mode); }
  catch (e) { console.warn('[notify]', e.message); return; }

  // Fire-and-forget through the shared, serialised, logged queue. We do
  // NOT await — the submit handler continues immediately and the request
  // runs out of band. The Function routes by `action` (+ dept for VS) to
  // the correct webhook; callGAS logs every failure, so the bare `.catch`
  // here only silences the unhandled rejection.
  sendDiscord(NOTIFY_FN_URL, action, payload, { label: `${system}/${action}` }).catch(() => {});
}
