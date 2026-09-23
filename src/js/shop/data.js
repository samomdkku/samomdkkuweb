// ==============================================
// SHOP DATA — Constants + pure helpers
//
// No DOM, no fetch — just the lookup tables and formatters used across
// products / orders / admin. Pure functions only; safe to unit-test.
// ==============================================

import { safeUrl } from '../utils.js';
import { imageBase, pictureAt } from '../uploads.js';

export const SHOP_SOURCES = [
  { id: 'all',      label: 'ทั้งหมด',            en: 'All' },
  { id: 'md',       label: 'MD',                en: 'MD',            color: 'var(--src-md)' },
  { id: 'rt',       label: 'RT',                en: 'RT',            color: 'var(--src-rt)' },
  { id: 'mdi',      label: 'MDI',               en: 'MDI',           color: 'var(--src-mdi)' },
  { id: 'sittikao', label: 'สมาคมสิทธิ์เก่า',     en: 'Sittikao',      color: 'var(--src-sittikao)' },
];

// Built-in fallback. Since migration 0057 the real list lives in
// shop_product_types and is loaded into `typesCache` at shop init; this
// array is used only before the fetch resolves (or if the table/migration
// is missing). The synthetic 'all' entry drives the "ทุกประเภท" filter chip
// and is never a real product type.
export const SHOP_TYPES = [
  { id: 'all',             label: 'ทุกประเภท',   icon: 'bi-grid' },
  { id: 'apparel-shirt',   label: 'เสื้อยืด',     icon: 'bi-bag' },
  { id: 'apparel-polo',    label: 'เสื้อโปโล',    icon: 'bi-person-vcard' },
  { id: 'apparel-trouser', label: 'กางเกง',      icon: 'bi-bookshelf' },
  { id: 'bag',             label: 'กระเป๋า',     icon: 'bi-handbag' },
  { id: 'stationery',      label: 'เครื่องเขียน', icon: 'bi-pencil' },
];

// ── Runtime catalog-config caches (migration 0057) ─────────────────────
// Loaded once at shop init (src/js/shop/index.js) and admin open
// (admin.js) from the DB, then read synchronously by the renderers.
let typesCache = null;         // shop_product_types rows (no synthetic 'all')
let qrsCache = null;           // shop_promptpay_qrs rows
let pickupCache = null;        // shop_pickup_locations rows

/** Store the loaded product-type rows. Pass [] to mark "loaded but empty". */
export function setShopTypes(rows) {
  typesCache = Array.isArray(rows) ? rows : [];
}

/** The type list for pickers/chips, with the synthetic 'all' chip first.
 *  Falls back to the built-in SHOP_TYPES until the DB list is loaded. */
export function getShopTypes() {
  if (!typesCache || typesCache.length === 0) return SHOP_TYPES;
  return [{ id: 'all', label: 'ทุกประเภท', icon: 'bi-grid' },
    ...typesCache.map((t) => ({ id: t.id, label: t.label, icon: t.icon || 'bi-tag' }))];
}

export function setPromptpayQrs(rows) {
  qrsCache = Array.isArray(rows) ? rows : [];
}

/** Loaded PromptPay accounts (empty array until loaded). */
export function getPromptpayQrs() {
  return qrsCache || [];
}

/** The is_default QR row, or null if none/unloaded. */
export function getDefaultQr() {
  return (qrsCache || []).find((q) => q.is_default) || null;
}

/** Look up one QR by id (numeric or string form). */
export function findQr(id) {
  if (id == null) return null;
  return (qrsCache || []).find((q) => String(q.id) === String(id)) || null;
}

export function setPickupLocations(rows) {
  pickupCache = Array.isArray(rows) ? rows : [];
}

export function getPickupLocations() {
  return pickupCache || [];
}

/** Look up one pickup location by id. */
export function findPickupLocation(id) {
  if (id == null) return null;
  return (pickupCache || []).find((l) => String(l.id) === String(id)) || null;
}

export const SHOP_SORT = [
  { id: 'newest',     label: 'ล่าสุด' },
  { id: 'price-asc',  label: 'ราคา ต่ำ→สูง' },
  { id: 'price-desc', label: 'ราคา สูง→ต่ำ' },
  { id: 'popular',    label: 'ขายดี' },
];

// Happy-path stages, in order. Off-path statuses (cancel, slip_mismatch)
// sit outside this sequence — they're shown as a pill but don't lay out
// the progress track.
export const STAGES_ORDER = ['pending', 'review', 'paid', 'produce', 'ready', 'done'];

export const STAGES_META = {
  // ── happy path ──────────────────────────────────────────────────
  pending:        { label: 'สั่งซื้อแล้ว',          icon: 'bi-bag-check',           short: 'สั่งซื้อแล้ว' },
  review:         { label: 'รอการตรวจสอบสลิป',      icon: 'bi-receipt',             short: 'ตรวจสลิป' },
  paid:           { label: 'ยืนยันการชำระเงิน',     icon: 'bi-check-circle',        short: 'ชำระแล้ว' },
  produce:        { label: 'สินค้าผลิตเสร็จแล้ว',    icon: 'bi-box-seam',            short: 'ผลิตเสร็จ' },
  ready:          { label: 'ประกาศรอบรับสินค้า',    icon: 'bi-megaphone-fill',      short: 'ประกาศแล้ว' },
  done:           { label: 'ได้รับสินค้าแล้ว',       icon: 'bi-bag-check-fill',      short: 'รับแล้ว' },
  // ── off-path (issue) ────────────────────────────────────────────
  // `tone` drives the chip colour so each off-path status reads at a
  // glance: warning (amber, customer-fixable) / danger (red, alert).
  slip_mismatch:  { label: 'สลิปไม่ถูกต้อง',       icon: 'bi-exclamation-triangle',   short: 'สลิปไม่ตรง', issue: true, tone: 'warning' },
  cancel:         { label: 'ยกเลิกคำสั่งซื้อ',     icon: 'bi-x-circle',               short: 'ยกเลิก',     issue: true, tone: 'danger' },
  // Per-item problem flag (มีปัญหา) — the single item-level issue state.
  // Replaces the old exchange/no_show item states. Unlike an order-level
  // cancel it KEEPS reserving stock (the item is still expected to be
  // fulfilled once the problem is resolved).
  issue:          { label: 'มีปัญหา',             icon: 'bi-exclamation-octagon',    short: 'มีปัญหา',    issue: true, tone: 'danger' },
};

/** Ordered list of "issue" statuses — anything tagged `issue: true`
 *  (order-level slip_mismatch/cancel + the item-level 'issue'). */
export const ISSUE_STATUSES = Object.entries(STAGES_META)
  .filter(([, m]) => m.issue)
  .map(([k]) => k);

/** Order-level problem statuses offered in the admin "สถานะปัญหา"
 *  picker. The item-level 'issue' is NOT a valid order status, so it's
 *  excluded here even though it's tagged issue:true above. */
export const ORDER_ISSUE_STATUSES = ['slip_mismatch', 'cancel'];

/** Orders whose money is NOT revenue yet: no slip, a slip nobody has checked,
 *  a slip that was rejected, or cancelled. The admin's รายรับสะสม card and the
 *  shop Discord message (public.shop_order_totals, 0206) both use this rule;
 *  data.test.js holds the SQL to this list. */
export const NOT_YET_REVENUE_STATUSES = ['pending', 'review', 'slip_mismatch', 'cancel'];

/** Returns the display label for an order. Currently a plain lookup;
 *  kept as a wrapper so call sites stay future-proof if labels ever
 *  need to vary on side-state again. */
export function statusLabelFor(order) {
  if (!order) return '';
  return STAGES_META[order.status]?.label || order.status;
}

export function statusMetaFor(order) {
  if (!order) return STAGES_META.pending;
  return STAGES_META[rollupOrderStage(order)] || STAGES_META.pending;
}

// ── Per-item fulfilment phase (Hybrid model, migration 0033/0034) ──────
// The order-level status carries the PAYMENT phase (pending→review→paid,
// + cancel/refund/slip_mismatch). Once paid, each line item carries its
// own fulfilment status here so products in one order can progress
// independently. The item off-path 'issue' (มีปัญหา) reuses STAGES_META.
export const ITEM_STAGES_ORDER = ['paid', 'produce', 'ready', 'done'];

const ITEM_STAGE_RANK = { paid: 0, produce: 1, ready: 2, done: 3 };

/** Numeric rank of an item fulfilment status (off-paths → 0 so an order
 *  with an issue item never looks "more done" than it is). */
export function itemStageRank(s) {
  return ITEM_STAGE_RANK[s] ?? 0;
}

/** Meta for one item status — reuses the shared STAGES_META labels. */
export function itemStatusMeta(s) {
  return STAGES_META[s] || STAGES_META.paid;
}

/** Roll an order's per-item statuses up into a single overall stage for
 *  the headline pill / progress track.
 *   - Pre-paid (pending/review) and order-level off-paths
 *     (cancel/slip_mismatch) are authoritative as-is.
 *   - Legacy orders whose whole-order status was advanced to
 *     produce/ready/done before the Hybrid migration keep that value.
 *   - For a 'paid' order, the overall stage is the LEAST-progressed item
 *     (one product still in production keeps the order "in production").
 *   An item tagged 'issue' ranks 0, so it holds the order back. */
export function rollupOrderStage(order) {
  if (!order) return 'pending';
  const status = order.status || 'pending';
  if (status !== 'paid') return status; // pre-paid, off-path, or legacy-advanced
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return 'paid';
  const minRank = Math.min(...items.map((it) => itemStageRank(it.item_status || 'paid')));
  return ITEM_STAGES_ORDER[minRank] || 'paid';
}

// Product-level stock status (independent of is_active soft-archive).
export const STOCK_STATUSES = ['available', 'sold_out', 'production_closed'];

export const STOCK_STATUS_META = {
  available:          { label: 'พร้อมจำหน่าย',     ribbon: '',            badgeCls: 'bg-success-subtle text-success border border-success-subtle' },
  sold_out:           { label: 'หมดสต็อก',         ribbon: 'SOLD OUT',     badgeCls: 'bg-danger-subtle text-danger border' },
  production_closed:  { label: 'ปิดรอบการผลิต',   ribbon: 'CLOSED',       badgeCls: 'bg-secondary-subtle text-secondary border' },
};

export function findSource(id) { return SHOP_SOURCES.find((s) => s.id === id); }
/** Look up a type by id — checks the loaded DB list first, then the
 *  built-in SHOP_TYPES fallback (and the synthetic 'all'). */
export function findType(id) {
  return (typesCache || []).find((t) => t.id === id)
      || SHOP_TYPES.find((t) => t.id === id);
}

/** Price the BUYER sees right now. Preorder products show preorder_price
 *  (falling back to price when the admin hasn't set a separate one).
 *  In-stock products always show the regular price. Cart / order rows
 *  freeze whatever price was active at add-to-cart time, so a later
 *  mode flip doesn't retroactively change anyone's order total. */
export function effectivePrice(p) {
  if (!p) return 0;
  if (p.is_presale && p.preorder_price != null) return Number(p.preorder_price) || 0;
  return Number(p.price) || 0;
}

/** What ONE unit of `size` costs right now — the price per size (0199).
 *
 *  ⛔ MIRROR of public.shop_unit_price(). The DATABASE is what charges (since
 *  0199 place_shop_order ignores the price the browser sends); this copy only
 *  lets the page SHOW that number before the order exists — in the product
 *  modal, the cart, and the transfer amount in the checkout QR, which must
 *  equal what the order will say. Both are asserted against the same table:
 *  price-cases.json, by data.test.js here and tools/shop0199-pricing.sql there.
 *
 *  Preorder: preorder-by-size → preorder price → price-by-size → price.
 *  Normal:   price-by-size → price. */
export function unitPriceFor(p, size) {
  if (!p) return 0;
  const pick = (map) => {
    const v = map && typeof map === 'object' ? map[size] : undefined;
    return v == null || v === '' ? null : Number(v);
  };
  const first = (...xs) => { for (const x of xs) if (x != null && Number.isFinite(Number(x))) return Number(x); return 0; };
  return p.is_presale
    ? first(pick(p.preorder_price_by_size), p.preorder_price, pick(p.price_by_size), p.price)
    : first(pick(p.price_by_size), p.price);
}

/** Cheapest and dearest size of a product, for a card that shows one price
 *  ("เริ่มต้น ฿250" when they differ). A product with no sizes has one: F. */
export function priceRange(p) {
  const sizes = Array.isArray(p?.sizes) && p.sizes.length ? p.sizes : ['F'];
  const prices = sizes.map((s) => unitPriceFor(p, s));
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Preorder products are sold without a stock check — the admin
 *  hasn't manufactured them yet and is collecting indications of
 *  interest. matrixIsConfigured / global stock_status still apply
 *  in admin views, but for buyer-side gating (variant OOS, qty cap,
 *  add-to-cart block) we treat is_presale = true as unlimited. */
export function isUnlimitedBuying(p) {
  return !!p?.is_presale;
}

/** Buyer-facing available qty for one (size, color) cell.
 *
 *  Math:  available = max(0, stock - reserved)
 *    stock     comes from `p.stock_matrix[key]` (what admin loaded)
 *    reserved  comes from `p.reserved_matrix[key]` (sum of qty in
 *              every active order, computed server-side by
 *              shop_reserved_matrix_all in migration 0030)
 *
 *  Returns:
 *    - null when admin hasn't configured a number for this cell —
 *      "untracked" stock, no display, no gate.
 *    - a non-negative integer otherwise. 0 = out, blocks add-to-cart.
 *
 *  Preorder products bypass this entirely (caller should check
 *  isUnlimitedBuying first). */
export function availableForVariant(p, size, color) {
  if (!p) return null;
  const stockMatrix = p.stock_matrix || {};
  const reservedMatrix = p.reserved_matrix || {};
  const key = stockKey(size, color);
  const stock = stockMatrix[key];
  if (typeof stock !== 'number' || !Number.isFinite(stock)) return null;
  const reserved = Number(reservedMatrix[key]) || 0;
  return Math.max(0, stock - reserved);
}

/** Same as availableForVariant but summed across every (size, color)
 *  cell on the product. Used for the card-level "เหลือ N ชิ้น" hint
 *  on the grid. Returns null when the matrix isn't configured. */
export function availableTotal(p) {
  if (!p) return null;
  const matrix = p.stock_matrix || {};
  const reserved = p.reserved_matrix || {};
  let total = 0;
  let any = false;
  for (const key of Object.keys(matrix)) {
    const stock = matrix[key];
    if (typeof stock !== 'number' || !Number.isFinite(stock)) continue;
    any = true;
    const r = Number(reserved[key]) || 0;
    total += Math.max(0, stock - r);
  }
  return any ? total : null;
}

/**
 * Aggregate total stock across a size×color matrix. Missing keys count as
 * "unknown / unlimited" (not zero) — admin hasn't filled them in.
 */
export function totalStock(matrix) {
  if (!matrix || typeof matrix !== 'object') return null;
  let sum = 0;
  let any = false;
  for (const v of Object.values(matrix)) {
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; any = true; }
  }
  return any ? sum : null;
}

/** A size+color combo is OOS when the matrix explicitly stores 0. */
export function stockKey(size, color) {
  return `${size || 'F'}-${color || 'default'}`;
}

/** Format an integer as a baht-style number, e.g. 1290 → "1,290". */
export function thb(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

/** Format an ISO date to Thai "DD month YY" with Buddhist-era year tail. */
export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const month = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()];
  return `${d.getDate()} ${month} ${((d.getFullYear() + 543)).toString().slice(-2)}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm}`;
}

/**
 * Generate a new order id of the form "<CODE><NNNN>" — e.g. "SH1234".
 * `code` comes from the first cart item's product.code (admin sets it
 * in the product editor). Falls back to "SH" when nothing is supplied.
 * The DB primary key enforces uniqueness, callers retry on collision.
 * (Random 4-digit pool of 9000 ids per code; collisions are rare and
 * the retry path absorbs them.)
 */
export function genOrderId(code) {
  const prefix = sanitizeOrderCode(code);
  const n = Math.floor(1000 + Math.random() * 9000); // 1000..9999
  return `${prefix}${n}`;
}

/** Normalise an admin-supplied product.code into something safe for
 *  an order id prefix: uppercase A–Z + 0–9, max 5 chars, fallback "SH". */
export function sanitizeOrderCode(code) {
  const cleaned = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return cleaned || 'SH';
}

/** Slug a string for use in a Drive folder name. */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9฀-๿]+/g, '-')  // keep Thai unicode block
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

/**
 * Read a batch's dates as a [{date, hours}] list — falls back to legacy
 * parallel `dates[]` + shared `hours` if `dates_full` is missing/empty.
 */
export function batchDateEntries(batch) {
  if (!batch) return [];
  const df = batch.dates_full;
  if (Array.isArray(df) && df.length) {
    return df.map((e) => ({ date: String(e?.date || ''), hours: String(e?.hours || '') }))
             .filter((e) => e.date);
  }
  const legacy = Array.isArray(batch.dates) ? batch.dates : [];
  const sharedHours = String(batch.hours || '');
  return legacy.filter(Boolean).map((d) => ({ date: String(d), hours: sharedHours }));
}

/** A banner's link_url, if it is one the storefront may follow; else null.
 *  http(s) opens a new tab; a same-site path or #fragment navigates here.
 *  Anything else (javascript:, data:, //host) is refused — the value is typed
 *  by a shop admin and followed by every visitor, dev and master included. */
export function bannerLinkTarget(href) {
  const h = String(href || '').trim();
  if (/^https?:\/\/[^\s]+$/i.test(h)) return { href: h, external: true };
  if (/^\/(?!\/)[^\s]*$/.test(h) || /^#[^\s]*$/.test(h)) return { href: h, external: false };
  return null;
}

/**
 * Why each cart line cannot be sold right now, by line index — the same
 * refusals place_shop_order makes (PRODUCT/SIZE/COLOR_UNAVAILABLE,
 * OUT_OF_STOCK), asked BEFORE the buyer is shown a QR to pay. The server
 * refusing after the transfer left a student with money sent and no order.
 * Stock is summed per variant across lines, as the server now does (0202).
 * @returns {Map<number,string>} index → Thai reason
 */
export function cartLineProblems(cart, products) {
  const out = new Map();
  const wanted = new Map();
  for (const it of cart || []) {
    const k = `${it.productId}|${stockKey(it.size, it.color)}`;
    wanted.set(k, (wanted.get(k) || 0) + (Number(it.qty) || 0));
  }
  (cart || []).forEach((it, i) => {
    const p = products?.[it.productId];
    const size = it.size || 'F';
    const color = it.color || 'default';
    if (!p || !p.is_active || ['sold_out', 'production_closed'].includes(p.stock_status)) {
      out.set(i, 'สินค้านี้ปิดขายแล้ว'); return;
    }
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    if (sizes.length ? !sizes.includes(size) : size !== 'F') { out.set(i, 'ไม่มีไซส์นี้แล้ว'); return; }
    const colors = Array.isArray(p.colors) ? p.colors : [];
    if (colors.length ? !colors.some((c) => c.id === color) : color !== 'default') {
      out.set(i, 'ไม่มีสีนี้แล้ว'); return;
    }
    if (isUnlimitedBuying(p)) return;
    const left = availableForVariant(p, size, color);
    const want = wanted.get(`${it.productId}|${stockKey(size, color)}`) || 0;
    if (left != null && want > left) out.set(i, left > 0 ? `เหลือเพียง ${left} ชิ้น` : 'สินค้าหมดแล้ว');
  });
  return out;
}

/**
 * One CSV cell, RFC 4180-quoted, SAFE TO OPEN IN A SPREADSHEET. A cell that
 * begins with = + - @ (or tab / CR) is a FORMULA to Excel and Sheets, and a
 * buyer's name or note lands in the export verbatim — so `=HYPERLINK(…)` in
 * a buyer note became a live link in the shop team's sheet. Such text is
 * prefixed with ' (shown as text, not run). Numbers pass through untouched.
 * `{ text }` from csvTextCell is written as-is: a value we built ourselves.
 */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in v) return v.text;
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** A phone number the spreadsheet keeps as TEXT — opened raw, 0812345678
 *  became the number 812345678. Only digits, +, - and spaces are kept, so
 *  the ="…" wrapper can never carry anything but a phone number. */
export function csvPhoneCell(v) {
  const digits = String(v || '').replace(/[^0-9+\- ]/g, '');
  return digits ? { text: `"=""${digits}"""` } : '';
}

/** A timestamp as Bangkok wall-clock time, `YYYY-MM-DD HH:mm:ss` — the raw
 *  UTC value put a 01:00 order on the previous day. '' for empty/invalid. */
export function bkkTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

// ── Product pictures (0203, docs/SHOP-GALLERY.md) ─────────────────────────
// ONE set of helpers for every reader of a product's pictures: the popup
// gallery, the lightbox, the cart / checkout / order thumbnails, the admin
// editor. A rule written in four places drifts in four directions.

/** No limit on a product's pictures (owner, 2026-09-22 — 0205). Picking more
 *  than this many AT ONCE asks first: an accidental whole-folder drag should
 *  not start hundreds of uploads. A confirm, not a cap. */
export const CONFIRM_PICK_OVER = 20;
// imageBase / pictureAt / PICTURE_WIDTHS moved to ../uploads.js (2026-09-23) so
// the home page's news pictures use the same cache without importing the shop.
// Re-exported here so every shop caller and test is unchanged.
export { imageBase, pictureAt, PICTURE_WIDTHS } from '../uploads.js';

/** A product's pictures, cover first: `images` when it has any, else the
 *  legacy single `image_url` (a row read before 0203, or a stale cache). */
export function productImages(p) {
  const list = Array.isArray(p?.images) ? p.images.filter((x) => x && x.url) : [];
  if (list.length) {
    return list.map((x) => ({ url: imageBase(x.url), w: x.w || null, h: x.h || null, color: x.color || null }));
  }
  return p?.image_url ? [{ url: imageBase(p.image_url), w: null, h: null, color: null }] : [];
}

/** Index of the first picture tagged with this colour, or -1. A tag naming a
 *  colour the product no longer offers counts as untagged (SHOP-GALLERY §4). */
export function imageIndexForColor(p, colorId) {
  if (!colorId) return -1;
  // An older order line can carry the colour's LABEL, not its id (orders.js
  // variantLabel accepts both) — resolve it to the id the pictures are tagged with.
  const colors = Array.isArray(p?.colors) ? p.colors : [];
  const c = colors.find((x) => x.id === colorId) || colors.find((x) => x.label === colorId);
  if (!c) return -1;
  return productImages(p).findIndex((x) => x.color === c.id);
}

/** The picture for a cart / order line: its colour's first, else the cover. */
export function pictureFor(p, colorId) {
  const imgs = productImages(p);
  if (!imgs.length) return '';
  const i = imageIndexForColor(p, colorId);
  return imgs[i >= 0 ? i : 0].url;
}

/** Alt text, generated — there is no field for an admin to leave blank. */
export function imageAlt(p, img, i, n) {
  const color = img?.color && (Array.isArray(p?.colors) ? p.colors : []).find((c) => c.id === img.color);
  const base = `${p?.name || 'สินค้า'}${color ? ` สี${color.label || color.id}` : ''}`;
  return n > 1 ? `${base} (รูปที่ ${i + 1} จาก ${n})` : base;
}

/** Inline style for a small product thumbnail (cart, checkout, my orders) —
 *  the line's colour picture, else the cover, else the product's stripe.
 *  ONE copy: there were three identical ones, one per file. */
export function thumbStyle(p, colorId, w = 200) {
  const url = pictureFor(p, colorId);
  if (url) {
    return `background-image: url('${safeUrl(pictureAt(url, w))}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}
