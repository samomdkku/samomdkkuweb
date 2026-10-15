// ==============================================
// SHOP ORDER FACTS — what needs an admin, how long it has waited, what
// happened to an order. Pure: no DOM, no fetch.
//
// Read by the orders tab's "ต้องจัดการ" row, the slip queue and the order
// popup. Each count here is the SAME predicate as the filter its tile applies
// (admin.js filterOrders / itemMatchesProgress), so the number on a tile is
// the number of orders the click shows.
// ==============================================

import { colorLabelFor } from './data.js';

/** An order with no slip this many days after it was placed is "stale" — it
 *  still holds its preorder slots and stock until someone cancels it. */
export const STALE_PENDING_DAYS = 3;
const DAY_MS = 24 * 3600 * 1000;

/** Milliseconds for a timestamp, or NaN. Compare instants as NUMBERS: the two
 *  writers spell them differently (a slip's `at` is `…606Z`, Postgres writes
 *  `…555207+00:00`), so a string comparison is right only by coincidence. */
const ms = (iso) => Date.parse(iso || '');
const earlier = (a, b) => (Number.isFinite(ms(a)) ? ms(a) : Infinity) - (Number.isFinite(ms(b)) ? ms(b) : Infinity);

function ageMs(iso, now) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? now - t : 0;
}

/**
 * Counts behind the attention tiles.
 * - review / mismatch / pending: orders in that ORDER status (the status facet)
 * - pendingStale: of the pending ones, placed more than STALE_PENDING_DAYS ago
 * - issueOrders: PAID orders with ≥1 line marked มีปัญหา
 * - oldestReviewAt: when the longest-waiting slip in the queue was sent (or,
 *   with no slip time, when the order was placed — the queue's own fallback)
 * `lineInScope` narrows to orders with a line in the caller's scope.
 */
export function attentionCounts(orders, now = Date.now(), { lineInScope = null } = {}) {
  const c = { review: 0, mismatch: 0, pending: 0, pendingStale: 0, issueOrders: 0, oldestReviewAt: null };
  for (const o of orders || []) {
    if (!o) continue;
    // With a scope (the orders table's แหล่งที่มา), an order counts when one
    // of its lines is in it — the table's own rule for showing an order.
    const lines = (Array.isArray(o.items) ? o.items : []).filter(Boolean);
    const inScope = lineInScope ? lines.filter(lineInScope) : lines;
    if (lineInScope && inScope.length === 0) continue;
    if (o.status === 'review') {
      c.review += 1;
      // The queue's own fallback: an order with no slip time waits from when
      // it was placed — so the tile and the queue agree on who waited longest.
      const at = slipSentAt(o) || o.placed_at;
      if (at && (!c.oldestReviewAt || earlier(at, c.oldestReviewAt) < 0)) c.oldestReviewAt = at;
    } else if (o.status === 'slip_mismatch') c.mismatch += 1;
    else if (o.status === 'pending') {
      c.pending += 1;
      if (ageMs(o.placed_at, now) > STALE_PENDING_DAYS * DAY_MS) c.pendingStale += 1;
    }
    // มีปัญหา is a line's stage once the order is PAID (rowDisplayStatus); a
    // cancelled order keeps the flag but needs nothing more. Same predicate as
    // the tile's filter: status paid AND an in-scope line marked issue.
    if (o.status === 'paid' && inScope.some((it) => it.item_status === 'issue')) c.issueOrders += 1;
  }
  return c;
}

/** When the buyer last sent a slip (the newest of several), else the
 *  recorded upload time, else ''. */
export function slipSentAt(o) {
  const slips = Array.isArray(o?.slips) ? o.slips.filter((s) => s && s.at) : [];
  const newest = slips.map((s) => s.at).sort(earlier).at(-1);
  return newest || o?.slip_uploaded_at || '';
}

/** The slip queue, oldest slip first — first sent, first checked. */
export function reviewQueue(orders) {
  return (orders || [])
    .filter((o) => o && o.status === 'review')
    .sort((a, b) => earlier(slipSentAt(a) || a.placed_at, slipSentAt(b) || b.placed_at)
      || String(a.id).localeCompare(String(b.id)));
}

/** "เพิ่งส่ง" · "25 นาที" · "3 ชม." · "2 วัน" — how long something has waited. */
export function waitedLabel(iso, now = Date.now()) {
  const ms = ageMs(iso, now);
  if (!iso || ms < 60 * 1000) return 'เพิ่งส่ง';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} นาที`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม.`;
  return `${Math.floor(h / 24)} วัน`;
}

/** Is a wait long enough to flag? A slip unchecked for a day is overdue. */
export function isOverdue(iso, now = Date.now(), hours = 24) {
  return !!iso && ageMs(iso, now) > hours * 3600 * 1000;
}

/**
 * Everything that happened to an order, oldest first: the order's own
 * timeline (payment / problem statuses) and every line's timeline (made,
 * announced, collected), each line entry naming its product and variant.
 * Entries with no time sort first; two at the same instant keep their
 * written order (an order's pending + review are often stamped together).
 */
export function orderHistory(order, products = []) {
  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const out = [];
  let seq = 0;
  for (const e of Array.isArray(order?.timeline) ? order.timeline : []) {
    if (!e) continue;
    out.push({ at: e.at || '', label: e.label || e.stage || '', stage: e.stage || '', by: e.by || '', what: '', seq: seq++ });
  }
  for (const it of Array.isArray(order?.items) ? order.items : []) {
    if (!it || !Array.isArray(it.item_timeline)) continue;
    const p = productMap.get(it.product_id);
    const variant = [it.size && it.size !== 'F' ? `ไซส์ ${it.size}` : '', colorLabelFor(p, it.color)].filter(Boolean).join(' · ');
    const what = `${p?.name || it.product_id || 'สินค้า'}${variant ? ` (${variant})` : ''}`;
    for (const e of it.item_timeline) {
      if (!e) continue;
      out.push({ at: e.at || '', label: e.label || e.stage || '', stage: e.stage || '', by: e.by || '', what, seq: seq++ });
    }
  }
  // An entry with no time sorts first (it predates timestamps).
  return out.sort((a, b) => ((Number.isFinite(ms(a.at)) ? ms(a.at) : -Infinity) - (Number.isFinite(ms(b.at)) ? ms(b.at) : -Infinity)) || a.seq - b.seq);
}

/** Who did it, in words a shop admin reads. Unknown values pass through. */
export function actorLabel(by) {
  if (!by) return '';
  if (by === 'admin') return 'แอดมิน';
  if (by === 'buyer' || by === 'customer') return 'ลูกค้า';
  // 'cascade' is what the production-status trigger writes (0034): the line
  // moved because its product was marked made / announced.
  if (by === 'system' || by === 'cascade') return 'ระบบ';
  return String(by);
}
