// ==============================================
// SHOP ADMIN — Orders: list, facets, create panel, CSV export, order detail
// modal. Split out of admin.js (task 19 — maintainability).
// ==============================================

import { escHtml, safeUrl, orderIdChipHtml } from '../utils.js';
import { dbRest } from '../db.js';
import {
  thb, fmtDate, fmtDateTime, STAGES_META, ORDER_ISSUE_STATUSES,
  SHOP_SOURCES, findSource, ITEM_STAGES_ORDER, rollupOrderStage, itemStatusMeta,
  effectivePrice, unitPriceFor, getShopTypes, findPickupLocation,
  csvCell, csvPhoneCell, bkkTime, imageBase, isRevenueOrder,
  rowDisplayStatus, colorLabelFor, orderMatchesYearFilter,
} from './data.js';
import { ALL_YEARS } from '../samo-year.js';
import { askConfirm } from '../confirm-modal.js';
import {
  listAllOrders, getOrder, updateOrderStatus, deleteOrder, setOrderItemStatus,
  addOrderItem, updateOrderItem, removeOrderItem, recomputeOrderTotals, adminCreateOrder,
  listProducts,
} from './api.js';
import { showShopToast } from './products.js';
import {
  attentionCounts, waitedLabel, isOverdue, orderHistory, actorLabel, STALE_PENDING_DAYS,
} from './order-facts.js';
import {
  state, setOrders, yearFilteredOrders, syncOrdersYear, loadSourceDefault, saveSourceDefault,
  applySourceDefaultOnce,
} from './admin.js';
import { renderVerifyQueue, slipSrc } from './admin-verify.js';
import { refreshPreorder } from './admin-preorder.js';

// ---------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------
export async function refreshOrders() {
  try {
    // Pull products in parallel — the product filter dropdown needs the
    // current list, and the bulk-advance bar resolves labels from it.
    const [orders, products] = await Promise.all([
      listAllOrders(),
      (!state.products || state.products.length === 0)
        ? listProducts({ activeOnly: false }).catch(() => [])
        : Promise.resolve(state.products),
    ]);
    setOrders(orders);
    if (products && products.length) state.products = products;
    // Apply the admin's saved default แหล่งที่มา filter on first load (getUser
    // is reliably resolved by the time the shop admin tab is open).
    applySourceDefaultOnce();
    // Drop selections for orders that no longer exist (e.g. just deleted).
    const liveIds = new Set(orders.map((o) => o.id));
    for (const id of [...state.ordersSelected]) {
      if (!liveIds.has(id)) state.ordersSelected.delete(id);
    }
    populateStatusFacet();         // re-render now that we have order counts
    populateOrdersSourceFacet();
    populateOrdersProductSelect();
    populateOrdersSizeFacet();
    populateOrdersColorFacet();
    populateOrdersItemStatusFacet();
    renderOrdersTable();   // also redraws the attention tiles
  } catch (e) {
    showShopToast(`โหลดคำสั่งซื้อล้มเหลว: ${e.message || e}`, 'error');
  }
}

// ---- facet count helpers (show "(N)" on every option, incl. 0) -------
//
// Counts are FACETED: each facet's option counts reflect the OTHER active
// facets but ignore the facet being counted itself (standard faceted-nav
// behaviour). So selecting สินค้า=เสื้อยืด makes the ไซส์ counts show only
// shirt items — not a global tally. `exclude` names the facet to skip:
// 'status' | 'product' (covers type too) | 'size' | 'color' | 'progress'.

/** Does this item pass every active facet EXCEPT the named one? The
 *  order-level สถานะ facet is applied here too (unless excluded). */
function itemPassesExcept(o, it, exclude) {
  if (exclude !== 'status' && state.ordersStatuses.size > 0 && !state.ordersStatuses.has(o.status)) return false;
  if (exclude !== 'source'   && !itemMatchesSource(it))     return false;
  if (exclude !== 'product'  && !itemMatchesProductDim(it)) return false;
  if (exclude !== 'size'     && !itemMatchesSize(it))       return false;
  if (exclude !== 'color'    && !itemMatchesColor(it))      return false;
  if (exclude !== 'progress' && !itemMatchesProgress(it))   return false;
  if (!itemMatchesPreorder(it)) return false;   // preorder always applies
  return true;
}

/** Orders bucketed by status — counting only orders that have ≥1 item
 *  surviving the OTHER active facets (so status counts track the item
 *  facets the same way the table does). */
function ordersCountByStatus() {
  const m = new Map();
  // The table is year-filtered (filterOrders), so a facet's "(N)" must be too.
  for (const o of yearFilteredOrders()) {
    const items = (o.items || []);
    const qualifies = items.length
      ? items.some((it) => itemPassesExcept(o, it, 'status'))
      : !anyItemFacetActive();
    if (!qualifies) continue;
    m.set(o.status, (m.get(o.status) || 0) + 1);
  }
  return m;
}

/** Line items bucketed by keyFn, restricted to items passing the other
 *  active facets (excluding `exclude`). */
function itemCountBy(keyFn, exclude) {
  const m = new Map();
  for (const o of yearFilteredOrders()) {
    for (const it of (o.items || [])) {
      if (!itemPassesExcept(o, it, exclude)) continue;
      const k = keyFn(it);
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}
/** Small count-badge pill (muted; selectable even at 0). */
function facetCountBadge(n) {
  return `<span class="badge bg-light text-muted border ms-auto" style="font-weight:500;">${n}</span>`;
}

/** Re-render every facet menu so their faceted counts reflect the latest
 *  selection. Called from each facet's change handler. Each populate*
 *  preserves checked state from the state Sets and re-runs updateFilterChromes. */
export function repopulateOrderFacets() {
  populateStatusFacet();
  populateOrdersSourceFacet();
  populateOrdersProductSelect();
  populateOrdersSizeFacet();
  populateOrdersColorFacet();
  populateOrdersItemStatusFacet();
}

export function populateStatusFacet() {
  const menu = document.getElementById('shopAdminOrdersStatusMenu');
  if (!menu) return;
  const counts = ordersCountByStatus();
  // Split the order-status options into the happy path (สถานะปกติ) vs the
  // problem statuses (สถานะปัญหา — m.issue) so the menu maps to how staff
  // actually think about orders: "is it progressing normally, or does it
  // need attention?".
  const entries = Object.entries(STAGES_META);
  const normal = entries.filter(([, m]) => !m.issue);
  // Only ORDER-level problem statuses belong in the order-status facet —
  // the item-level 'issue' (มีปัญหา) is never an order status.
  const issues = ORDER_ISSUE_STATUSES.map((k) => [k, STAGES_META[k]]).filter(([, m]) => m);
  const row = ([k, m]) => {
    const n = counts.get(k) || 0;
    return `
    <label class="dropdown-item d-flex align-items-center gap-2 py-1 ${n === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
      <input type="checkbox" class="form-check-input m-0"
             data-facet="status" value="${escHtml(k)}"
             ${state.ordersStatuses.has(k) ? 'checked' : ''} />
      <i class="bi ${escHtml(m.icon || 'bi-dot')} small ${m.issue ? 'text-danger' : 'text-muted'}"></i>
      <span class="small flex-grow-1">${escHtml(m.label)}</span>
      ${facetCountBadge(n)}
    </label>`;
  };
  const groupHead = (label) => `
    <div class="dropdown-header small text-uppercase fw-bold px-2 py-1">${escHtml(label)}</div>`;
  menu.innerHTML =
    groupHead('สถานะปกติ') + normal.map(row).join('')
    + (issues.length ? `<div class="dropdown-divider my-1"></div>` + groupHead('สถานะปัญหา') + issues.map(row).join('') : '');
  menu.querySelectorAll('input[data-facet="status"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersStatuses.add(cb.value);
      else state.ordersStatuses.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  updateFilterChromes();
}

/** แหล่งที่มา (owning-dept) facet — item-level: an order shows when it has
 *  ≥1 item whose product_source is selected. The menu footer lets the
 *  admin pin the CURRENT source selection as their personal default (and
 *  clear it back to "show all"). */
export function populateOrdersSourceFacet() {
  const menu = document.getElementById('shopAdminOrdersSourceMenu');
  if (!menu) return;
  const sources = SHOP_SOURCES.filter((s) => s.id !== 'all');
  const counts = itemCountBy((it) => itemSource(it), 'source');
  const rows = sources.map((s) => {
    const n = counts.get(s.id) || 0;
    return `
      <label class="dropdown-item d-flex align-items-center gap-2 py-1 ${n === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
        <input type="checkbox" class="form-check-input m-0"
               data-facet="source" value="${escHtml(s.id)}"
               ${state.ordersSources.has(s.id) ? 'checked' : ''} />
        <span style="width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:${escHtml(s.color || 'var(--bs-secondary)')};"></span>
        <span class="small flex-grow-1">${escHtml(s.label)}</span>
        ${facetCountBadge(n)}
      </label>`;
  }).join('');
  const hasDefault = loadSourceDefault().length > 0;
  const footer = `
    <div class="dropdown-divider my-1"></div>
    <div class="px-1 pt-1 d-grid gap-1">
      <button type="button" class="btn btn-outline-secondary btn-sm" data-source-action="save">
        <i class="bi bi-star me-1"></i> ตั้งตัวกรองนี้เป็นค่าเริ่มต้นของฉัน
      </button>
      <button type="button" class="btn btn-link btn-sm text-muted p-0 ${hasDefault ? '' : 'd-none'}" data-source-action="clear">
        ล้างค่าเริ่มต้น (แสดงทั้งหมด)
      </button>
    </div>`;
  menu.innerHTML = rows + footer;
  menu.querySelectorAll('input[data-facet="source"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersSources.add(cb.value);
      else state.ordersSources.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  menu.querySelector('[data-source-action="save"]')?.addEventListener('click', () => {
    const chosen = [...state.ordersSources];
    saveSourceDefault(chosen);
    showShopToast(chosen.length
      ? `ตั้งค่าเริ่มต้นเป็น ${chosen.map((id) => findSource(id)?.label || id).join(', ')} แล้ว`
      : 'ตั้งค่าเริ่มต้นเป็น "ทั้งหมด" แล้ว', 'success');
    populateOrdersSourceFacet();
  });
  menu.querySelector('[data-source-action="clear"]')?.addEventListener('click', () => {
    saveSourceDefault([]);
    showShopToast('ล้างค่าเริ่มต้นแล้ว — ครั้งต่อไปจะแสดงทั้งหมด', 'success');
    populateOrdersSourceFacet();
  });
  updateFilterChromes();
}

export function populateOrdersProductSelect() {
  const menu = document.getElementById('shopAdminOrdersProductMenu');
  if (!menu) return;
  const products = state.products || [];
  if (products.length === 0) {
    menu.innerHTML = '<div class="small text-muted px-2">ไม่มีสินค้า</div>';
    return;
  }
  // Group products under their type. The type row is a TYPE-level filter
  // ("เสื้อยืด" → every shirt); the products under it are SUBTYPE filters
  // (one specific product). Only types that actually have products show.
  const byType = new Map();
  for (const p of products) {
    const t = p.type || 'other';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(p);
  }
  // Order types per SHOP_TYPES (skip the 'all' sentinel), then any
  // leftover/unknown types at the end.
  const typeOrder = getShopTypes().filter((t) => t.id !== 'all').map((t) => t.id);
  const seen = new Set();
  const orderedTypes = [
    ...typeOrder.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !typeOrder.includes(t)),
  ].filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

  // Counts = line items ordered for each product / type (0 when nothing
  // ordered yet — the product still lists so admin sees the full catalogue).
  const byProductCount = itemCountBy((it) => it.product_id, 'product');
  const byTypeCount = itemCountBy((it) => productTypeOf(it.product_id), 'product');

  menu.innerHTML = orderedTypes.map((t) => {
    const meta = getShopTypes().find((x) => x.id === t);
    const label = meta?.label || (t === 'other' ? 'อื่น ๆ' : t);
    const icon = meta?.icon || 'bi-tag';
    const group = byType.get(t) || [];
    const tN = byTypeCount.get(t) || 0;
    return `
      <div class="orders-facet-group">
        <label class="dropdown-item d-flex align-items-center gap-2 py-1 fw-bold ${tN === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
          <input type="checkbox" class="form-check-input m-0"
                 data-facet="type" value="${escHtml(t)}"
                 ${state.ordersTypes.has(t) ? 'checked' : ''} />
          <i class="bi ${escHtml(icon)} small"></i>
          <span class="small flex-grow-1">${escHtml(label)}</span>
          ${facetCountBadge(tN)}
        </label>
        ${group.map((p) => {
          const pN = byProductCount.get(p.id) || 0;
          return `
          <label class="dropdown-item d-flex align-items-center gap-2 py-1 ps-4 ${pN === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
            <input type="checkbox" class="form-check-input m-0"
                   data-facet="product" value="${escHtml(p.id)}"
                   ${state.ordersProducts.has(p.id) ? 'checked' : ''} />
            <span class="small text-muted flex-grow-1">${escHtml(p.name || p.id)}</span>
            ${facetCountBadge(pN)}
          </label>`;
        }).join('')}
      </div>`;
  }).join('');

  menu.querySelectorAll('input[data-facet="product"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersProducts.add(cb.value);
      else state.ordersProducts.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  menu.querySelectorAll('input[data-facet="type"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersTypes.add(cb.value);
      else state.ordersTypes.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  updateFilterChromes();
}

/** Every size defined across the catalogue, unioned with any size that
 *  actually appears in orders — so unused-but-defined sizes still list
 *  (at count 0), matching the ความคืบหน้า "show the whole set" behaviour. */
function collectOrderSizes() {
  const set = new Set();
  for (const p of (state.products || [])) {
    for (const s of (Array.isArray(p.sizes) ? p.sizes : [])) set.add(s);
  }
  for (const o of (state.orders || [])) {
    for (const it of (o.items || [])) set.add(it.size || 'F');
  }
  return [...set].sort((a, b) => String(a).localeCompare(String(b)));
}

/** Every colour defined across the catalogue (id → label), unioned with
 *  any colour present in orders. 'default' only appears when ordered. */
function collectOrderColors() {
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  const map = new Map();   // id -> label
  for (const p of (state.products || [])) {
    for (const c of (Array.isArray(p.colors) ? p.colors : [])) {
      const id = c.id || c.label;
      if (id && !map.has(id)) map.set(id, c.label || id);
    }
  }
  for (const o of (state.orders || [])) {
    for (const it of (o.items || [])) {
      const id = it.color || 'default';
      if (map.has(id)) continue;
      map.set(id, id === 'default' ? 'มาตรฐาน'
        : (colorLabelFor(productMap.get(it.product_id), id) || id));
    }
  }
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th'));
}

export function populateOrdersSizeFacet() {
  const menu = document.getElementById('shopAdminOrdersSizeMenu');
  if (!menu) return;
  const sizes = collectOrderSizes();
  if (sizes.length === 0) {
    menu.innerHTML = '<div class="small text-muted px-2">ไม่มีไซส์</div>';
    updateFilterChromes();
    return;
  }
  const counts = itemCountBy((it) => it.size || 'F', 'size');
  menu.innerHTML = sizes.map((s) => {
    const n = counts.get(s) || 0;
    return `
    <label class="dropdown-item d-flex align-items-center gap-2 py-1 ${n === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
      <input type="checkbox" class="form-check-input m-0" data-facet="size" value="${escHtml(s)}"
             ${state.ordersSizes.has(s) ? 'checked' : ''} />
      <span class="small flex-grow-1">${escHtml(s === 'F' ? 'Free size' : s)}</span>
      ${facetCountBadge(n)}
    </label>`;
  }).join('');
  menu.querySelectorAll('input[data-facet="size"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersSizes.add(cb.value);
      else state.ordersSizes.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  updateFilterChromes();
}

export function populateOrdersColorFacet() {
  const menu = document.getElementById('shopAdminOrdersColorMenu');
  if (!menu) return;
  const colors = collectOrderColors();
  if (colors.length === 0) {
    menu.innerHTML = '<div class="small text-muted px-2">ไม่มีสี</div>';
    updateFilterChromes();
    return;
  }
  const counts = itemCountBy((it) => it.color || 'default', 'color');
  menu.innerHTML = colors.map(([id, label]) => {
    const n = counts.get(id) || 0;
    return `
    <label class="dropdown-item d-flex align-items-center gap-2 py-1 ${n === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
      <input type="checkbox" class="form-check-input m-0" data-facet="color" value="${escHtml(id)}"
             ${state.ordersColors.has(id) ? 'checked' : ''} />
      <span class="small flex-grow-1">${escHtml(label)}</span>
      ${facetCountBadge(n)}
    </label>`;
  }).join('');
  menu.querySelectorAll('input[data-facet="color"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersColors.add(cb.value);
      else state.ordersColors.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  updateFilterChromes();
}

/** The full canonical per-item fulfilment status set, in workflow order —
 *  the happy path (paid→produce→ready→done) plus the item-level issue
 *  states. Always offered in the facet (even at count 0) so admin can see
 *  the whole pipeline; any unexpected value actually present is appended. */
function allItemStatuses() {
  const order = Object.keys(STAGES_META);
  const canon = [...ITEM_STAGES_ORDER, 'issue'];
  const present = new Set();
  for (const o of (state.orders || [])) {
    for (const it of (o.items || [])) present.add(it.item_status || 'paid');
  }
  const all = new Set([...canon, ...present]);
  return [...all].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

/** Count of line items at each raw item_status, faceted by the other
 *  active filters (excludes the progress facet itself). */
function itemStatusCounts() {
  return itemCountBy((it) => it.item_status || 'paid', 'progress');
}

export function populateOrdersItemStatusFacet() {
  const menu = document.getElementById('shopAdminOrdersItemStatusMenu');
  if (!menu) return;
  const statuses = allItemStatuses();
  const counts = itemStatusCounts();
  menu.innerHTML = statuses.map((s) => {
    const n = counts.get(s) || 0;
    const m = STAGES_META[s];
    return `
    <label class="dropdown-item d-flex align-items-center gap-2 py-1 ${n === 0 ? 'opacity-50' : ''}" style="cursor:pointer;">
      <input type="checkbox" class="form-check-input m-0" data-facet="itemstatus" value="${escHtml(s)}"
             ${state.ordersItemStatuses.has(s) ? 'checked' : ''} />
      <i class="bi ${escHtml(m?.icon || 'bi-dot')} small ${m?.issue ? 'text-danger' : 'text-muted'}"></i>
      <span class="small flex-grow-1">${escHtml(m?.label || s)}</span>
      <span class="badge bg-light text-muted border">${n}</span>
    </label>`;
  }).join('');
  menu.querySelectorAll('input[data-facet="itemstatus"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.ordersItemStatuses.add(cb.value);
      else state.ordersItemStatuses.delete(cb.value);
      repopulateOrderFacets();
      renderOrdersTable();
    });
  });
  updateFilterChromes();
}

/** Sync the facet-trigger badges + the "clear all" chip with current state. */
function updateFilterChromes() {
  const clear  = document.getElementById('shopAdminOrdersClearFilters');
  const sN = state.ordersStatuses.size;
  const pN = state.ordersProducts.size + state.ordersTypes.size;
  const zN = state.ordersSizes.size;
  const cN = state.ordersColors.size;
  const iN = state.ordersItemStatuses.size;
  const srcN = state.ordersSources.size;
  const setBadge = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(n);
    el.classList.toggle('d-none', n === 0);
  };
  setBadge('shopAdminOrdersStatusBadge', sN);
  setBadge('shopAdminOrdersSourceBadge', srcN);
  setBadge('shopAdminOrdersProductBadge', pN);
  setBadge('shopAdminOrdersSizeBadge', zN);
  setBadge('shopAdminOrdersColorBadge', cN);
  setBadge('shopAdminOrdersItemStatusBadge', iN);
  if (clear) {
    const preorderActive = (state.ordersPreorder || 'all') !== 'all';
    clear.classList.toggle('d-none',
      sN === 0 && pN === 0 && zN === 0 && cN === 0 && iN === 0 && srcN === 0
      && !state.ordersSearch && !preorderActive);
  }
}

// (The old "bulk advance by product+status" bar was removed — its job
// is now done automatically by the per-product production_status
// trigger added in migration 0025. Admin changes the product status
// once; orders cascade. No manual bulk button needed.)

/** The "ต้องจัดการ" row above the orders table: what is waiting on an admin,
 *  each tile one click from the orders it counts. The counts and the filter
 *  a tile applies are the same predicate (order-facts.js says which). */
function renderStats() {
  const host = document.getElementById('shopAdminStats');
  if (!host) return;
  // Each filter tile counts within the admin's แหล่งที่มา, because the filter
  // its click applies keeps แหล่งที่มา — the number on a tile is the number of
  // orders the click shows. The slip queue is NOT scoped by source, so neither
  // is its tile.
  //
  // Year (0230): the OPEN-WORK tiles — ยังไม่ส่งสลิป, สลิปไม่ถูกต้อง, มีปัญหา —
  // count EVERY year, and their click switches the table to ทุกปี
  // (applyQuickFilter), so the number is still the number the click shows.
  // Owner's rule for the year work (HANDOFF §22): an UNFINISHED past-year
  // item is always shown — after a handover last year's unpaid orders still
  // hold stock and still need chasing. Only รายรับสะสม (money already in, a
  // per-year book) reads the picked year. The slip queue is all years too.
  const yearScoped = yearFilteredOrders();
  const scoped = attentionCounts(state.orders, Date.now(), { lineInScope: itemMatchesSource });
  const queue = attentionCounts(state.orders);
  // Only orders whose slip was CHECKED — the รายรับสะสม rule (isRevenueOrder),
  // the same number the shop's Discord message reports.
  const revenue = yearScoped
    .filter(isRevenueOrder)
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const overdue = isOverdue(queue.oldestReviewAt);
  // The tiles are rebuilt on every table render; keep keyboard focus on the
  // same tile across the rebuild.
  const focused = document.activeElement?.closest?.('#shopAdminStats [data-shop-quick], #shopAdminStats [data-shop-goto]');
  const focusKey = focused ? (focused.dataset.shopQuick ? `[data-shop-quick="${focused.dataset.shopQuick}"]` : `[data-shop-goto="${focused.dataset.shopGoto}"]`) : null;
  const tile = ({ n, label, sub, tone, quick, goto, unit = 'ออเดอร์', value }) => {
    const active = !!quick && quickFilterIs(quick);
    // A tile whose filter is ON stays a button even at 0, so it can be
    // switched off — otherwise the table sits filtered with nothing saying why.
    const live = value != null || n > 0 || active;
    const attr = quick ? `data-shop-quick="${quick}"` : `data-shop-goto="${goto}"`;
    const inner = `
      <span class="attn-label">${label}</span>
      <span class="attn-value">${value ?? `${thb(n)}<span class="attn-unit">${unit}</span>`}</span>
      <span class="attn-sub">${active ? 'กำลังกรองอยู่ · กดอีกครั้งเพื่อยกเลิก' : sub}</span>`;
    return live
      ? `<button type="button" class="attn-tile ${tone ? `is-${tone}` : ''} ${active ? 'is-active' : ''}" ${attr}
           ${quick ? `aria-pressed="${active}"` : ''}>${inner}</button>`
      : `<div class="attn-tile is-quiet">${inner}</div>`;
  };
  host.innerHTML = [
    tile({ n: queue.review, label: 'รอตรวจสลิป', tone: overdue ? 'danger' : 'review', goto: 'verify',
      sub: queue.review ? `${overdue ? 'รอนานสุด' : 'เก่าสุด'} ${waitedLabel(queue.oldestReviewAt)} · ตรวจเลย <i class="bi bi-arrow-right"></i>` : 'ไม่มีค้าง' }),
    tile({ n: scoped.mismatch, label: 'สลิปไม่ถูกต้อง', tone: 'warning', quick: 'slip_mismatch',
      sub: scoped.mismatch ? 'รอลูกค้าส่งสลิปใหม่' : 'ไม่มี' }),
    tile({ n: scoped.pending, label: 'ยังไม่ส่งสลิป', tone: scoped.pendingStale ? 'warning' : '', quick: 'pending',
      sub: scoped.pending ? (scoped.pendingStale ? `เกิน ${STALE_PENDING_DAYS} วัน ${scoped.pendingStale} ออเดอร์ — ยังกันสต็อกไว้` : 'ยังอยู่ในเวลา') : 'ไม่มี' }),
    tile({ n: scoped.issueOrders, label: 'มีปัญหา', tone: 'danger', quick: 'issue',
      sub: scoped.issueOrders ? 'มีสินค้าที่ทำเครื่องหมายมีปัญหา' : 'ไม่มี' }),
    tile({ label: 'รายรับสะสม', value: `฿${thb(revenue)}`, goto: 'sales',
      sub: 'ตรวจสลิปแล้ว · ดูยอดขาย <i class="bi bi-arrow-right"></i>' }),
  ].join('');
  if (focusKey) host.querySelector(focusKey)?.focus({ preventScroll: true });
}

/** The quick filters the attention tiles apply. Each REPLACES the table's
 *  filters (status, product, size, colour, progress, preorder, search) and
 *  keeps แหล่งที่มา — the admin's own scope. */
const QUICK_FILTERS = {
  slip_mismatch: { statuses: ['slip_mismatch'] },
  pending:       { statuses: ['pending'] },
  // A line's มีปัญหา is its stage only once the order is paid (rowDisplayStatus);
  // a cancelled order keeps the flag but needs nothing more.
  issue:         { statuses: ['paid'], itemStatuses: ['issue'] },
};
function quickFilterIs(kind) {
  const q = QUICK_FILTERS[kind];
  if (!q) return false;
  const same = (set, arr = []) => set.size === arr.length && arr.every((x) => set.has(x));
  return same(state.ordersStatuses, q.statuses) && same(state.ordersItemStatuses, q.itemStatuses)
    && !state.ordersProducts.size && !state.ordersTypes.size && !state.ordersSizes.size
    && !state.ordersColors.size && !(state.ordersSearch || '').trim() && (state.ordersPreorder || 'all') === 'all';
}
export function applyQuickFilter(kind) {
  const q = QUICK_FILTERS[kind];
  if (!q) return;
  const off = quickFilterIs(kind);   // clicking the active tile again clears it
  state.ordersStatuses.clear();
  state.ordersItemStatuses.clear();
  state.ordersProducts.clear();
  state.ordersTypes.clear();
  state.ordersSizes.clear();
  state.ordersColors.clear();
  state.ordersSearch = '';
  state.ordersPreorder = 'all';
  const search = document.getElementById('shopAdminOrdersSearch'); if (search) search.value = '';
  document.querySelectorAll('#shopAdminOrdersPreorderGroup [data-orders-preorder]')
    .forEach((b) => b.classList.toggle('is-active', b.dataset.ordersPreorder === 'all'));
  if (!off) {
    (q.statuses || []).forEach((x) => state.ordersStatuses.add(x));
    (q.itemStatuses || []).forEach((x) => state.ordersItemStatuses.add(x));
    // The tile counted every year (repopulateOrderFacets), so the click shows
    // every year — or a past year's unfinished orders hide behind the picker.
    if (state.ordersYear !== ALL_YEARS) syncOrdersYear(ALL_YEARS);
  }
  repopulateOrderFacets();
  renderOrdersTable();
}


function rowStatusPill(status) {
  const meta = STAGES_META[status] || STAGES_META.pending;
  return `
    <span class="status-pill" data-status="${escHtml(status)}">
      <span class="pulse"></span>
      <i class="bi ${escHtml(meta.icon)}"></i>
      <span>${escHtml(meta.short || meta.label)}</span>
    </span>`;
}

export function renderOrdersTable() {
  const tbody = document.getElementById('shopAdminOrdersTbody');
  if (!tbody) return;
  const list = filterOrders(state.orders);
  const countEl = document.getElementById('shopAdminOrdersCount');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">ไม่มีรายการ</td></tr>`;
    if (countEl) countEl.textContent = 'แสดง 0 รายการสินค้า · 0 ชิ้น · 0 คำสั่งซื้อ';
    syncBulkBar();
    renderStats();   // both outcomes, or a tile stays lit for a filter that changed
    return;
  }
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  let lineCount = 0;
  let qtyTotal = 0;   // sum of quantities (pieces) — reconciles with the preorder demand page
  // One <tr> per line item; the Order / Customer / Slip / chevron cells
  // span the order's rows so the grouping stays readable while each
  // product shows its own qty + progress (same product bought preorder
  // vs normal = separate rows because they're separate items).
  tbody.innerHTML = list.map((o) => {
    const buyerName  = o.buyer_name  || o.buyer_label || '—';
    const buyerEmail = o.buyer_email || '';
    // When a product / type / preorder facet is active, show ONLY the
    // matching line items of each order — not the whole order. Filtering
    // for "เสื้อยืด" should surface the shirt rows, not every unrelated
    // item the buyer happened to add to the same คำสั่งซื้อ.
    const items = visibleOrderItems(o);
    const rows = items.length ? items : [null];
    lineCount += rows.length;
    qtyTotal += items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const span = rows.length;
    const selectCell = `
      <td rowspan="${span}" class="order-group-cell oc-sel text-center">
        <input type="checkbox" class="form-check-input" data-order-select="${escHtml(o.id)}"
               ${state.ordersSelected.has(o.id) ? 'checked' : ''} title="เลือกคำสั่งซื้อ" />
      </td>`;
    const orderCell = `
      <td rowspan="${span}" class="order-group-cell oc-order">
        <div class="order-id">${orderIdChipHtml(o.id)}</div>
        <div class="small text-muted text-nowrap">${fmtDate(o.placed_at)}</div>
        <div class="small text-nowrap" style="font-weight:600;">฿${thb(o.total)}</div>
      </td>
      <td rowspan="${span}" class="order-group-cell oc-cust">
        <div style="font-weight:600;">${escHtml(buyerName)}</div>
        ${buyerEmail ? `<div class="small text-muted">${escHtml(buyerEmail)}</div>` : ''}
        ${o.buyer_phone ? `<div class="small text-muted"><i class="bi bi-telephone me-1"></i>${escHtml(o.buyer_phone)}</div>` : ''}
      </td>`;
    const slipCell = `
      <td rowspan="${span}" class="order-group-cell oc-slip">
        ${(o.slip_url || (Array.isArray(o.slips) && o.slips.length))
          ? `<span class="text-success small text-nowrap"><i class="bi bi-check-circle-fill me-1"></i>ส่งแล้ว${Array.isArray(o.slips) && o.slips.length > 1 ? ` (${o.slips.length})` : ''}</span>`
          : `<span class="text-muted small text-nowrap"><i class="bi bi-dash-circle me-1"></i>ยังไม่ส่ง</span>`}
      </td>`;
    const chevronCell = `<td rowspan="${span}" class="order-group-cell oc-chev"><i class="bi bi-chevron-right"></i></td>`;

    return rows.map((it, idx) => {
      const p = it ? productMap.get(it.product_id) : null;
      const name = it ? (p?.name || it.product_id || '(สินค้าถูกลบ)') : '—';
      const variant = it ? itemVariantLabel(p, it) : '';
      const lineTotal = it ? (Number(it.unit_price) || 0) * (Number(it.qty) || 0) : 0;
      const status = rowDisplayStatus(o, it);
      const src = it ? findSource(itemSource(it)) : null;
      const sourceTag = src
        ? `<div class="small text-muted d-flex align-items-center gap-1" style="margin-top:2px;">
             <span style="width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:${escHtml(src.color || 'var(--bs-secondary)')};"></span>${escHtml(src.label)}
           </div>`
        : '';
      return `
        <tr class="is-clickable ${idx === 0 ? 'order-group-start' : 'order-group-cont'}" data-order-id="${escHtml(o.id)}">
          ${idx === 0 ? selectCell + orderCell : ''}
          <td class="oc-prod">
            <div class="small" style="font-weight:600;">
              ${escHtml(name)}
              ${it?.is_preorder ? '<span class="preorder-tag ms-1">พรีออเดอร์</span>' : ''}
            </div>
            ${variant ? `<div class="small text-muted">${escHtml(variant)}</div>` : ''}
            ${sourceTag}
          </td>
          <td class="oc-qty"><span style="font-weight:700;">${it ? `× ${Number(it.qty) || 0}` : '—'}</span></td>
          <td class="oc-price"><span style="font-weight:600;">฿${thb(lineTotal)}</span></td>
          ${idx === 0 ? slipCell : ''}
          <td class="oc-status">${rowStatusPill(status)}</td>
          ${idx === 0 ? chevronCell : ''}
        </tr>`;
    }).join('');
  }).join('');

  if (countEl) {
    countEl.textContent = `แสดง ${lineCount} รายการสินค้า · ${qtyTotal} ชิ้น · ${list.length} คำสั่งซื้อ`;
  }
  syncBulkBar();
  renderStats();   // the attention tiles show which quick filter is on
}

/** Reflect the current selection into the bulk action bar + the
 *  select-all header checkbox (checked / indeterminate / clear). */
export function syncBulkBar() {
  const bar = document.getElementById('shopAdminOrdersBulkBar');
  const n = state.ordersSelected.size;
  if (bar) {
    bar.classList.toggle('d-none', n === 0);
    bar.classList.toggle('d-flex', n > 0);
    const countEl = document.getElementById('shopAdminOrdersBulkCount');
    if (countEl) countEl.textContent = `เลือก ${n} คำสั่งซื้อ`;
  }
  const selectAll = document.getElementById('shopAdminOrdersSelectAll');
  if (selectAll) {
    const ids = filterOrders(state.orders).map((o) => o.id);
    const selectedVisible = ids.filter((id) => state.ordersSelected.has(id)).length;
    selectAll.checked = ids.length > 0 && selectedVisible === ids.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < ids.length;
  }
}

/** Bulk hard-delete every selected order (each via the same deleteOrder
 *  path as the single-order modal — RLS-gated, slip trashed). Runs
 *  sequentially so one failure doesn't abort the rest; reports a summary. */
export async function bulkDeleteSelectedOrders() {
  const ids = [...state.ordersSelected];
  if (ids.length === 0) return;
  if (!await askConfirm({ title: `ลบ ${ids.length} คำสั่งซื้อถาวร?`, body: 'ไม่สามารถกู้คืนได้', yes: 'ลบถาวร' })) return;
  const btn = document.getElementById('shopAdminOrdersBulkDelete');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังลบ…'; }
  let ok = 0;
  const failed = [];
  for (const id of ids) {
    try {
      await deleteOrder(id);
      ok += 1;
      state.ordersSelected.delete(id);
    } catch (e) {
      console.error('[shop/admin] bulk delete failed for', id, e);
      failed.push(id);
    }
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash3 me-1"></i> ลบที่เลือก'; }
  if (failed.length === 0) showShopToast(`ลบ ${ok} คำสั่งซื้อแล้ว`, 'success');
  else showShopToast(`ลบสำเร็จ ${ok} · ล้มเหลว ${failed.length} (${failed.join(', ')})`, 'error');
  await refreshOrders();
}

/** Size · colour label for an admin table line. */
export function itemVariantLabel(p, it) {
  const parts = [];
  if (it.size && it.size !== 'F') parts.push(`ไซส์ ${it.size}`);
  const c = colorLabelFor(p, it.color);
  if (c) parts.push(c);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------
// Admin "create order" — inline panel above the orders table. Builds a
// draft (buyer + items) in memory, then submits via adminCreateOrder
// (atomic place_shop_order RPC, buyer_id null).
// ---------------------------------------------------------------------
export function toggleOrderCreate() {
  state.orderCreateDraft = state.orderCreateDraft
    ? null
    : { buyerName: '', buyerPhone: '', buyerEmail: '', items: [] };
  renderOrderCreatePanel();
}

function renderOrderCreatePanel() {
  const host = document.getElementById('shopAdminOrderCreateHost');
  if (!host) return;
  const d = state.orderCreateDraft;
  if (!d) { host.innerHTML = ''; return; }
  const products = (state.products || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const subtotal = d.items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  host.innerHTML = `
    <div class="order-create-panel mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="mb-0 fw-bold">สร้างคำสั่งซื้อใหม่</h6>
        <button type="button" class="btn-close" data-oc-cancel aria-label="ปิด"></button>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small mb-0">ชื่อลูกค้า</label>
          <input class="form-control form-control-sm" data-oc-name value="${escHtml(d.buyerName)}" />
        </div>
        <div class="col-md-4">
          <label class="form-label small mb-0">เบอร์โทร</label>
          <input class="form-control form-control-sm" data-oc-phone value="${escHtml(d.buyerPhone)}" />
        </div>
        <div class="col-md-4">
          <label class="form-label small mb-0">อีเมล (ถ้ามี)</label>
          <input class="form-control form-control-sm" data-oc-email value="${escHtml(d.buyerEmail)}" />
        </div>
      </div>
      ${d.items.length ? `
        <div class="mb-2">
          ${d.items.map((it, i) => {
            const p = (state.products || []).find((x) => x.id === it.productId);
            const variant = itemVariantLabel(p, it);
            return `
            <div class="d-flex align-items-center gap-2 small py-1">
              <span class="flex-grow-1">${escHtml(p?.name || it.productId)}
                ${variant ? `<span class="text-muted">${escHtml(variant)}</span>` : ''} × ${it.qty}</span>
              <span>฿${thb((Number(it.price) || 0) * (Number(it.qty) || 0))}</span>
              <button type="button" class="btn btn-sm btn-outline-danger" data-oc-remove="${i}"><i class="bi bi-x"></i></button>
            </div>`;
          }).join('')}
          <div class="text-end fw-bold mt-1">รวม ฿${thb(subtotal)}</div>
        </div>` : '<div class="small text-muted mb-2">ยังไม่มีสินค้าในคำสั่งซื้อ</div>'}
      <div class="d-flex gap-2 flex-wrap align-items-end p-2 rounded" style="background:var(--shop-ink-50);">
        <div style="min-width:150px; flex:1 1 150px;">
          <label class="form-label small mb-0">สินค้า</label>
          <select class="form-select form-select-sm" data-oc-product>
            ${products.map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`).join('')}
          </select>
        </div>
        <div style="width:96px;"><label class="form-label small mb-0">ไซส์</label><select class="form-select form-select-sm" data-oc-size>${variantSizeOptionsHtml(products[0])}</select></div>
        <div style="width:120px;"><label class="form-label small mb-0">สี</label><select class="form-select form-select-sm" data-oc-color>${variantColorOptionsHtml(products[0])}</select></div>
        <div style="width:64px;"><label class="form-label small mb-0">จำนวน</label><input type="number" min="1" max="99" value="1" class="form-control form-control-sm" data-oc-qty /></div>
        <div style="width:84px;"><label class="form-label small mb-0">ราคา/ชิ้น</label><input type="number" min="0" class="form-control form-control-sm" data-oc-price placeholder="auto" /></div>
        <button type="button" class="btn btn-outline-secondary btn-sm" data-oc-add><i class="bi bi-plus-lg me-1"></i>เพิ่มสินค้า</button>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button type="button" class="btn btn-ghost btn-sm" data-oc-cancel>ยกเลิก</button>
        <button type="button" class="btn btn-shop btn-sm" data-oc-save ${d.items.length ? '' : 'disabled'}>
          <i class="bi bi-check2 me-1"></i>บันทึกคำสั่งซื้อ
        </button>
      </div>
    </div>`;
  host.querySelector('[data-oc-name]')?.addEventListener('input', (e) => { d.buyerName = e.target.value; });
  host.querySelector('[data-oc-phone]')?.addEventListener('input', (e) => { d.buyerPhone = e.target.value; });
  host.querySelector('[data-oc-email]')?.addEventListener('input', (e) => { d.buyerEmail = e.target.value; });
  host.querySelectorAll('[data-oc-cancel]').forEach((b) => b.addEventListener('click', () => { state.orderCreateDraft = null; renderOrderCreatePanel(); }));
  host.querySelectorAll('[data-oc-remove]').forEach((b) => b.addEventListener('click', () => { d.items.splice(Number(b.dataset.ocRemove), 1); renderOrderCreatePanel(); }));
  host.querySelector('[data-oc-add]')?.addEventListener('click', () => onOrderCreateAddItem(host));
  host.querySelector('[data-oc-save]')?.addEventListener('click', onOrderCreateSave);
  // Repopulate the size + colour dropdowns from the chosen product's
  // declared variants whenever the product selection changes.
  host.querySelector('[data-oc-product]')?.addEventListener('change', (e) => {
    const p = (state.products || []).find((x) => x.id === e.target.value);
    const sizeSel = host.querySelector('[data-oc-size]');
    const colorSel = host.querySelector('[data-oc-color]');
    if (sizeSel) sizeSel.innerHTML = variantSizeOptionsHtml(p);
    if (colorSel) colorSel.innerHTML = variantColorOptionsHtml(p);
  });
}

function onOrderCreateAddItem(host) {
  const d = state.orderCreateDraft;
  if (!d) return;
  const productId = host.querySelector('[data-oc-product]')?.value;
  if (!productId) { showShopToast('เลือกสินค้าก่อน', 'warn'); return; }
  const product = (state.products || []).find((p) => p.id === productId);
  const size = (host.querySelector('[data-oc-size]')?.value || 'F').trim() || 'F';
  const color = (host.querySelector('[data-oc-color]')?.value || 'default').trim() || 'default';
  const qty = Math.max(1, Math.min(99, Number(host.querySelector('[data-oc-qty]')?.value) || 1));
  const priceRaw = host.querySelector('[data-oc-price]')?.value;
  const price = priceRaw !== '' && priceRaw != null
    ? Math.max(0, Number(priceRaw) || 0)
    : unitPriceFor(product, size);
  d.items.push({ productId, size, color, qty, price });
  renderOrderCreatePanel();
}

async function onOrderCreateSave() {
  const d = state.orderCreateDraft;
  if (!d || !d.items.length) { showShopToast('เพิ่มสินค้าก่อน', 'warn'); return; }
  const phoneDigits = (d.buyerPhone || '').replace(/\D/g, '');
  if (d.buyerPhone && (phoneDigits.length < 9 || phoneDigits.length > 10)) {
    showShopToast('เบอร์โทรไม่ถูกต้อง', 'warn'); return;
  }
  const btn = document.querySelector('[data-oc-save]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก…'; }
  try {
    const first = (state.products || []).find((p) => p.id === d.items[0].productId);
    const order = await adminCreateOrder({
      buyerName: d.buyerName, buyerPhone: d.buyerPhone, buyerEmail: d.buyerEmail,
      items: d.items, code: first?.code || '',
    });
    showShopToast(`สร้างคำสั่งซื้อ ${order.id} แล้ว`, 'success');
    state.orderCreateDraft = null;
    renderOrderCreatePanel();
    await refreshOrders();
  } catch (e) {
    showShopToast(`สร้างไม่สำเร็จ: ${e.message || e}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2 me-1"></i>บันทึกคำสั่งซื้อ'; }
  }
}

/** Look up a product's type id (e.g. 'apparel-shirt') for facet matching. */
function productTypeOf(productId) {
  return (state.products || []).find((p) => p.id === productId)?.type || '';
}

/** Does this line item match the active "what product" dimension
 *  (specific product OR product-type)? Within that dimension the two
 *  facets are OR-combined; an empty dimension matches everything. */
function itemMatchesProductDim(it) {
  const products = state.ordersProducts;
  const types    = state.ordersTypes;
  if (products.size === 0 && types.size === 0) return true;
  return products.has(it.product_id) || types.has(productTypeOf(it.product_id));
}

/** The owning department (แหล่งที่มา) of a line item. Prefers the frozen
 *  `product_source` snapshot (mig 0058); falls back to the live product's
 *  source for any pre-0058 item whose column wasn't backfilled. */
function itemSource(it) {
  return it.product_source
      || (state.products || []).find((p) => p.id === it.product_id)?.source
      || '';
}

/** แหล่งที่มา facet — within-facet OR; empty matches everything. */
function itemMatchesSource(it) {
  const s = state.ordersSources;
  return s.size === 0 || s.has(itemSource(it));
}

/** Does this line item match the active preorder facet? */
function itemMatchesPreorder(it) {
  const pf = state.ordersPreorder || 'all';
  if (pf === 'preorder') return !!it.is_preorder;
  if (pf === 'in_stock') return !it.is_preorder;
  return true;
}

/** Size facet — within-facet OR; empty matches everything. */
function itemMatchesSize(it) {
  const sizes = state.ordersSizes;
  return sizes.size === 0 || sizes.has(it.size || 'F');
}

/** Colour facet — within-facet OR; empty matches everything. */
function itemMatchesColor(it) {
  const colors = state.ordersColors;
  return colors.size === 0 || colors.has(it.color || 'default');
}

/** Per-item progress facet — matches the item's RAW fulfilment
 *  `item_status` (paid/produce/ready/done/issue), NOT the effective
 *  rowDisplayStatus. The effective status masks item progress behind the
 *  order's payment phase (an item that's `produce` in a still-`review`
 *  order would otherwise never surface here), which is exactly the bug
 *  the user hit. Payment phase lives on the separate สถานะ facet. */
function itemMatchesProgress(it) {
  const set = state.ordersItemStatuses;
  return set.size === 0 || set.has(it.item_status || 'paid');
}

/** Is any item-level facet (product / type / size / colour / progress /
 *  preorder) currently active? */
function anyItemFacetActive() {
  return state.ordersProducts.size > 0
    || state.ordersTypes.size > 0
    || state.ordersSizes.size > 0
    || state.ordersColors.size > 0
    || state.ordersItemStatuses.size > 0
    || state.ordersSources.size > 0
    || (state.ordersPreorder || 'all') !== 'all';
}

/** The line items of an order that survive the item-level facets
 *  (source / product / type / size / colour / progress / preorder). Drives
 *  both the table (renders only these rows) and the order-level filterOrders
 *  pass (an order shows iff it has ≥1 surviving item). */
function visibleOrderItems(o) {
  const items = (Array.isArray(o.items) ? o.items : []).filter(Boolean);
  if (!anyItemFacetActive()) return items;
  return items.filter((it) =>
    itemMatchesSource(it) && itemMatchesProductDim(it) && itemMatchesSize(it)
    && itemMatchesColor(it) && itemMatchesPreorder(it)
    && itemMatchesProgress(it));
}

/** Apply the current facet filters. Within-facet OR, across-facet AND.
 *  Reused by the CSV export so the export honors the visible filter.
 *  Product / type / preorder are item-level: an order passes when it has
 *  at least one line item surviving those facets. */
export function filterOrders(source) {
  const statuses = state.ordersStatuses;
  const q = (state.ordersSearch || '').trim();
  const itemFacetActive = anyItemFacetActive();
  return (source || []).filter((o) => {
    if (!orderMatchesYearFilter(o, state.ordersYear)) return false;
    if (statuses.size > 0 && !statuses.has(o.status)) return false;
    if (itemFacetActive && visibleOrderItems(o).length === 0) return false;
    if (q) {
      const hay = [
        o.id || '',
        o.buyer_name || '',
        o.buyer_label || '',
        o.buyer_email || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------
// CSV export — exports the CURRENTLY-FILTERED list (so the file matches
// what the admin is looking at on screen, not the unfiltered super-set).
// Excel-compatible: UTF-8 BOM + CRLF + RFC4180 quoting.
// ---------------------------------------------------------------------


// One ROW PER LINE ITEM (tidy / long format) — every order + item field
// in its own column so the file is filterable, sortable, and pivotable in
// Excel / Sheets. Order-level fields are repeated on each of an order's
// item rows so every row is self-contained; `order_item_index` /
// `order_item_count` flag multi-item orders, and `line_total` sums across
// rows to the order subtotal (so SUM(line_total) is correct, while order
// `subtotal/fee/total` are order-level — dedupe by order_id before summing
// those).
function ordersToCsv(orders, productMap) {
  const headers = [
    // ---- order identity & lifecycle ----
    'order_id', 'placed_at', 'updated_at',
    'order_status', 'order_status_label',
    'order_is_preorder',
    // ---- buyer ----
    'buyer_name', 'buyer_email', 'buyer_phone', 'buyer_label', 'buyer_id',
    // ---- line item ----
    'order_item_index', 'order_item_count',
    'product_id', 'product_name', 'product_type', 'product_source',
    'size', 'color', 'fit', 'qty', 'unit_price', 'line_total',
    'item_status', 'item_status_label', 'item_is_preorder',
    // ---- order money (repeated per row) ----
    'order_subtotal', 'order_fee', 'order_total',
    // ---- payment / fulfilment ----
    'slip_count', 'slip_url', 'slip_uploaded_at',
    'pickup_batch_id', 'pickup_location',
    // ---- notes ----
    'buyer_note', 'admin_note', 'cancel_reason',
  ];

  const typeLabel = (t) => getShopTypes().find((x) => x.id === t)?.label || t || '';
  const srcLabel  = (s) => findSource(s)?.label || s || '';

  const rows = [];
  for (const o of orders) {
    // Honor the active item-level facets so the export matches the table.
    const items = visibleOrderItems(o);
    const slipCount = Array.isArray(o.slips) ? o.slips.length : (o.slip_url ? 1 : 0);
    const orderCells = {
      head: [o.id, bkkTime(o.placed_at), bkkTime(o.updated_at),
             o.status || '', STAGES_META[o.status]?.label || o.status || '',
             o.is_preorder ? 'yes' : 'no'],
      buyer: [o.buyer_name || '', o.buyer_email || '', csvPhoneCell(o.buyer_phone),
              o.buyer_label || '', o.buyer_id || ''],
      money: [o.subtotal || 0, o.fee || 0, o.total || 0],
      fulfil: [slipCount, o.slip_url || '', bkkTime(o.slip_uploaded_at),
               o.pickup_batch_id || '', o.pickup_location || ''],
      notes: [o.buyer_note || '', o.admin_note || '', o.cancel_reason || ''],
    };
    // Edge case: order with zero (visible) items still gets one row so it
    // isn't silently dropped from the export.
    const list = items.length ? items : [null];
    list.forEach((it, i) => {
      const p = it ? productMap.get(it.product_id) : null;
      const qty = it ? (Number(it.qty) || 0) : 0;
      const unit = it ? (Number(it.unit_price) || 0) : 0;
      const itemStatus = it ? (it.item_status || 'paid') : '';
      const itemCells = it
        ? [i + 1, items.length,
           it.product_id || '', p?.name || it.product_id || '',
           typeLabel(p?.type), srcLabel(it.product_source || p?.source),
           it.size || '', colorLabelFor(p, it.color) || it.color || '', it.fit || '',
           qty, unit, qty * unit,
           itemStatus, (itemStatusMeta?.(itemStatus)?.label) || STAGES_META[itemStatus]?.label || itemStatus,
           it.is_preorder ? 'yes' : 'no']
        : [1, 0, '', '', '', '', '', '', '', 0, 0, 0, '', '', ''];
      rows.push([
        ...orderCells.head,
        ...orderCells.buyer,
        ...itemCells,
        ...orderCells.money,
        ...orderCells.fulfil,
        ...orderCells.notes,
      ].map(csvCell).join(','));
    });
  }
  // UTF-8 BOM so Excel renders Thai correctly. CRLF per RFC4180.
  return '﻿' + [headers.join(','), ...rows].join('\r\n');
}

export function exportOrdersCsv() {
  const list = filterOrders(state.orders);
  if (list.length === 0) {
    showShopToast('ไม่มีรายการในตัวกรองปัจจุบัน', 'warn');
    return;
  }
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  const csv = ordersToCsv(list, productMap);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const stamp = bkkTime(new Date()).replace(/[: ]/g, '-').slice(0, 16);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `samo-shop-orders-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  const lineItems = list.reduce((s, o) => s + Math.max(1, visibleOrderItems(o).length), 0);
  showShopToast(`ส่งออก ${list.length} คำสั่งซื้อ · ${lineItems} รายการสินค้าแล้ว`, 'success');
}

export let modalOrder = null;
let modalEditItems = false;    // line-item edit mode toggle
export function openOrderModal(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) return;
  modalOrder = o;
  modalEditItems = false;
  const idEl = document.getElementById('shopAdminOrderModalId');
  const body = document.getElementById('shopAdminOrderModalBody');
  if (idEl) idEl.textContent = String(o.id);
  if (body) body.innerHTML = orderModalBodyHtml(o);

  wireOrderModalBody(body);

  // The Delete button itself is wired exactly once, in ensureMounted() —
  // it is outside `body` so it survives every repaint here, and wiring it
  // again on each open was the bug (see ensureMounted's comment).

  // Reset the delete button to its idle label every time the modal
  // opens — the previous open may have left it in the "กำลังลบ…"
  // spinning state (success path didn't restore the label because the
  // modal closes), so a subsequent click on a different order would
  // appear stuck. Defensive: always re-paint here.
  const delBtn = document.getElementById('shopAdminOrderModalDelete');
  if (delBtn) {
    delBtn.disabled = false;
    delBtn.innerHTML = '<i class="bi bi-trash3 me-1"></i> ลบคำสั่งซื้อ';
  }

  const inst = window.bootstrap?.Modal.getOrCreateInstance(document.getElementById('shopAdminOrderModal'));
  inst?.show();
}

/** Wire the body-level controls (order-level status chips + per-item
 *  fulfilment chips). Called on open and after any in-place repaint. */
function wireOrderModalBody(body) {
  // Order-level payment / issue chip → write immediately.
  body.querySelectorAll('[data-set-status]').forEach((btn) => {
    btn.addEventListener('click', () => applyOrderStatusImmediate(btn.dataset.setStatus));
  });
  // Per-item fulfilment chip → write immediately (one item at a time).
  body.querySelectorAll('[data-item-status]').forEach((btn) => {
    btn.addEventListener('click', () => onItemStatusClick(btn, body));
  });

  // Line-item editing.
  body.querySelector('[data-toggle-edit-items]')?.addEventListener('click', () => {
    modalEditItems = !modalEditItems;
    repaintOrderModalBody();
  });
  body.querySelectorAll('[data-save-item]').forEach((btn) => {
    btn.addEventListener('click', () => onSaveOrderItem(btn, body));
  });
  body.querySelectorAll('[data-remove-item]').forEach((btn) => {
    btn.addEventListener('click', () => onRemoveOrderItem(btn.dataset.itemId));
  });
  body.querySelector('[data-add-item-btn]')?.addEventListener('click', () => onAddOrderItem(body));
  // Repopulate size + colour + preorder default from the chosen product.
  body.querySelector('[data-add-product]')?.addEventListener('change', (e) => {
    const p = (state.products || []).find((x) => x.id === e.target.value);
    const sizeSel = body.querySelector('[data-add-size]');
    const colorSel = body.querySelector('[data-add-color]');
    const preSel = body.querySelector('[data-add-preorder]');
    const priceInp = body.querySelector('[data-add-price]');
    if (sizeSel) sizeSel.innerHTML = variantSizeOptionsHtml(p);
    if (colorSel) colorSel.innerHTML = variantColorOptionsHtml(p);
    if (preSel) preSel.value = p?.is_presale ? 'true' : 'false';
    if (priceInp) priceInp.placeholder = p ? `auto (฿${effectivePrice(p)})` : 'auto';
  });
}

/** Re-fetch the modal's order, sync into state, and repaint the body so
 *  edits (items/totals/statuses) reflect immediately. */
function repaintOrderModalBody() {
  if (!modalOrder) return;
  const body = document.getElementById('shopAdminOrderModalBody');
  if (!body) return;
  // Preserve any unsaved note text across the repaint (notes are only
  // persisted on modal close).
  const note = document.getElementById('shopAdminOrderModalNote')?.value;
  const custNote = document.getElementById('shopAdminOrderModalCustomerNote')?.value;
  body.innerHTML = orderModalBodyHtml(modalOrder);
  wireOrderModalBody(body);
  if (note != null) {
    const noteEl = document.getElementById('shopAdminOrderModalNote');
    if (noteEl) noteEl.value = note;
  }
  if (custNote != null) {
    const cnEl = document.getElementById('shopAdminOrderModalCustomerNote');
    if (cnEl) cnEl.value = custNote;
  }
}

/** Write an order-level payment / issue status immediately, keep the
 *  modal open, and reload so any server-side cascade (order→paid seeds
 *  item_status) is reflected. */
async function applyOrderStatusImmediate(nextStatus) {
  if (!modalOrder || !nextStatus) return;
  if ((modalOrder.status || 'pending') === nextStatus) return;
  const orderId = modalOrder.id;
  try {
    await updateOrderStatus(orderId, nextStatus, { label: STAGES_META[nextStatus]?.label || nextStatus });
    showShopToast(`${orderId} → ${STAGES_META[nextStatus]?.label || nextStatus}`, 'success');
    await reloadModalOrderFromServer(orderId);
    if (state.tab === 'verify') renderVerifyQueue();
    if (state.tab === 'preorder') refreshPreorder();
  } catch (e) {
    console.error('[shop/admin] status update failed:', e);
    showShopToast(`อัปเดตล้มเหลว: ${e?.message || e}`, 'error');
  }
}

/** Re-read ONE order (by id — never "whatever modalOrder is by the time the
 *  fetch returns") and repaint the modal only if that order is still open. */
export async function reloadModalOrderFromServer(orderId = modalOrder?.id) {
  if (!orderId) return;
  try {
    const fresh = await getOrder(orderId);
    if (fresh) {
      if (modalOrder?.id === orderId) modalOrder = fresh;
      const idx = (state.orders || []).findIndex((x) => x.id === fresh.id);
      if (idx >= 0) state.orders[idx] = fresh;
    }
  } catch (e) {
    console.warn('[shop/admin] reload order failed:', e);
  }
  if (modalOrder?.id === orderId) await repaintOrderModalBody();
  renderOrdersTable();   // also redraws the attention tiles
}

/** Save all edits for one existing line item (ไซส์ / สี / จำนวน / ราคา /
 *  ประเภท) in a single PATCH, then recompute totals + reload. */
async function onSaveOrderItem(btn, body) {
  // Captured before any await: the admin can close this order or open another
  // while the save is in flight, and `modalOrder` then names THAT one (or null).
  const order = modalOrder;
  if (!order) return;
  const itemId = btn.dataset.itemId;
  const row = body.querySelector(`[data-edit-row="${CSS.escape(String(itemId))}"]`);
  const item = (order.items || []).find((i) => String(i.id) === String(itemId));
  if (!row || !item) return;
  const size = (row.querySelector('[data-edit-size]')?.value || 'F').trim() || 'F';
  const color = (row.querySelector('[data-edit-color]')?.value || 'default').trim() || 'default';
  const qty = Math.max(1, Math.min(99, Number(row.querySelector('[data-edit-qty]')?.value) || 1));
  const unitPrice = Math.max(0, Number(row.querySelector('[data-edit-price]')?.value) || 0);
  const isPreorder = row.querySelector('[data-edit-preorder]')?.value === 'true';
  btn.disabled = true;
  try {
    await updateOrderItem(itemId, { size, color, qty, unit_price: unitPrice, is_preorder: isPreorder });
    await recomputeOrderTotals(order.id);
    showShopToast('บันทึกรายการแล้ว', 'success');
    await reloadModalOrderFromServer(order.id);
    if (state.tab === 'preorder') refreshPreorder();
  } catch (e) {
    showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
    btn.disabled = false;
  }
}

async function onRemoveOrderItem(itemId) {
  const order = modalOrder;
  if (!order || !itemId) return;
  const items = (order.items || []).filter(Boolean);
  if (items.length <= 1) {
    showShopToast('คำสั่งซื้อต้องมีสินค้าอย่างน้อย 1 รายการ — ลบทั้งคำสั่งซื้อแทน', 'warn');
    return;
  }
  if (!await askConfirm({ title: 'ลบรายการนี้ออกจากคำสั่งซื้อ?', yes: 'ลบ' })) return;
  try {
    await removeOrderItem(itemId);
    await recomputeOrderTotals(order.id);
    showShopToast('ลบรายการแล้ว', 'success');
    await reloadModalOrderFromServer(order.id);
  } catch (e) {
    showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error');
  }
}

async function onAddOrderItem(body) {
  const order = modalOrder;
  if (!order) return;
  const productId = body.querySelector('[data-add-product]')?.value;
  const size = (body.querySelector('[data-add-size]')?.value || 'F').trim() || 'F';
  const color = (body.querySelector('[data-add-color]')?.value || 'default').trim() || 'default';
  const qty = Math.max(1, Math.min(99, Number(body.querySelector('[data-add-qty]')?.value) || 1));
  const priceRaw = body.querySelector('[data-add-price]')?.value;
  if (!productId) { showShopToast('เลือกสินค้าก่อน', 'warn'); return; }
  const product = (state.products || []).find((p) => p.id === productId);
  const unitPrice = priceRaw !== '' && priceRaw != null
    ? Math.max(0, Number(priceRaw) || 0)
    : unitPriceFor(product, size);
  const isPreorder = body.querySelector('[data-add-preorder]')?.value === 'true';
  const variant = [size !== 'F' ? `ไซส์ ${size}` : '', colorLabelFor(product, color)].filter(Boolean).join(' · ');
  if (!await askConfirm({ title: `เพิ่ม "${product?.name || productId}"${variant ? ` (${variant})` : ''} × ${qty} เข้าคำสั่งซื้อ?`,
    body: `฿${unitPrice}/ชิ้น`, yes: 'เพิ่ม', danger: false })) return;
  const btn = body.querySelector('[data-add-item-btn]');
  if (btn) { btn.disabled = true; }
  try {
    await addOrderItem(order.id, {
      productId, size, color, qty, unitPrice,
      isPreorder,
      itemStatus: 'paid', // admin advances it per-item afterwards
    });
    await recomputeOrderTotals(order.id);
    showShopToast('เพิ่มสินค้าแล้ว', 'success');
    await reloadModalOrderFromServer(order.id);
  } catch (e) {
    showShopToast(`เพิ่มล้มเหลว: ${e.message || e}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function onItemStatusClick(btn, body) {
  const order = modalOrder;
  if (!order) return;
  const itemId = btn.dataset.itemId;
  const status = btn.dataset.itemStatus;
  const item = (order.items || []).find((i) => String(i.id) === String(itemId));
  if (!item || (item.item_status || 'paid') === status) return;
  const rowChips = btn.parentElement?.querySelectorAll('[data-item-status]') || [];
  rowChips.forEach((b) => { b.disabled = true; });
  try {
    const updated = await setOrderItemStatus(itemId, status, {
      label: itemStatusMeta(status).label,
      currentTimeline: item.item_timeline,
    });
    // Sync local state so the repaint + orders table reflect the change.
    item.item_status = updated.item_status;
    item.item_timeline = updated.item_timeline;
    const row = state.orders.find((x) => x.id === order.id);
    const rowItem = row && (row.items || []).find((i) => String(i.id) === String(itemId));
    if (rowItem) { rowItem.item_status = updated.item_status; rowItem.item_timeline = updated.item_timeline; }
    showShopToast(`${order.id}: ${itemStatusMeta(status).label}`, 'success');
    // Repaint the modal body in place — if this order is still the open one.
    if (modalOrder === order) {
      body.innerHTML = orderModalBodyHtml(order);
      wireOrderModalBody(body);
    }
    renderOrdersTable();   // also redraws the attention tiles
  } catch (e) {
    console.error('[shop/admin] item status update failed:', e);
    showShopToast(`อัปเดตล้มเหลว: ${e?.message || e}`, 'error');
    rowChips.forEach((b) => { b.disabled = false; });
  }
}

export async function deleteCurrentOrder() {
  const order = modalOrder;
  if (!order) return;
  if (!await askConfirm({ title: `ลบคำสั่งซื้อ ${order.id} ถาวร?`, body: 'ไม่สามารถกู้คืนได้', yes: 'ลบถาวร' })) return;
  const btn = document.getElementById('shopAdminOrderModalDelete');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังลบ…'; }
  try {
    await deleteOrder(order.id);
    showShopToast(`ลบคำสั่งซื้อ ${order.id} แล้ว`, 'success');
    if (modalOrder === order) {
      const inst = window.bootstrap?.Modal.getInstance(document.getElementById('shopAdminOrderModal'));
      inst?.hide();
      modalOrder = null;
    }
    await refreshOrders();
  } catch (e) {
    showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error');
  } finally {
    // Always restore the button — `openOrderModal` also re-paints it
    // on next open, but doing it here too means a quick re-click on the
    // same modal works without waiting for a re-open cycle.
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-trash3 me-1"></i> ลบคำสั่งซื้อ'; }
  }
}

// Order-level chips now cover the PAYMENT phase only — production /
// delivery progress is per line item (Hybrid model, mig 0033/0034).
const PAYMENT_STAGES = ['pending', 'review', 'paid'];
// Per-item fulfilment chips offered in the detail modal.
const ITEM_FULFIL_STAGES = ['paid', 'produce', 'ready', 'done'];
// Single per-item problem state (มีปัญหา). Keeps reserving stock.
const ITEM_ISSUE_STAGES = ['issue'];

/** Normalise an order's slips to [{url, at}], folding in the legacy
 *  single slip when the array is empty. Mirrors api.js. */
export function orderSlipList(o) {
  const arr = Array.isArray(o?.slips) ? o.slips.slice() : [];
  if (arr.length === 0 && o?.slip_url) {
    arr.push({ url: o.slip_url, at: o.slip_uploaded_at || o.placed_at || null });
  }
  return arr.filter((s) => s && s.url);
}

/** Thumbnails for every slip the buyer attached (admin sees all, not
 *  just the latest). */
function slipThumbsHtml(o) {
  const slips = orderSlipList(o);
  if (!slips.length) {
    return `
      <div class="slip-thumb">
        <div class="text-center"><i class="bi bi-x-octagon fs-1"></i>
        <div class="mt-1">ยังไม่ได้รับสลิป</div></div>
      </div>`;
  }
  return `
    <div class="slip-thumb-grid mb-2">
      ${slips.map((s) => `
        <a href="${safeUrl(s.url)}" target="_blank" rel="noreferrer" class="slip-thumb">
          <img src="${safeUrl(slipSrc(s.url, 600))}" alt="สลิป" loading="lazy" />
          ${s.at ? `<span class="slip-thumb-date">${escHtml(fmtDateTime(s.at))}</span>` : ''}
        </a>`).join('')}
    </div>`;
}

/** <option> list for a product's sizes, used by the admin order
 *  create/add-item size dropdowns. Falls back to a single free-size
 *  'F' option when the product declares no sizes. */
function variantSizeOptionsHtml(product, selected) {
  const sizes = (Array.isArray(product?.sizes) && product.sizes.length)
    ? product.sizes.slice()
    : ['F'];
  // Preserve the item's stored size even if the product's size list has
  // since changed — otherwise editing a row would silently re-write it.
  if (selected && !sizes.includes(selected)) sizes.unshift(selected);
  return sizes.map((s) => {
    const label = s === 'F' ? 'Free size' : s;
    return `<option value="${escHtml(s)}" ${s === selected ? 'selected' : ''}>${escHtml(label)}</option>`;
  }).join('');
}

/** <option> list for a product's colours. Value is the colour id (or
 *  label when no id), so it round-trips through colorLabelFor(). When
 *  the product has no colours, a single 'default' option keeps the
 *  stored value consistent with the buyer-side cart. */
function variantColorOptionsHtml(product, selected) {
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  if (colors.length === 0) {
    return `<option value="default" selected>— ไม่มีตัวเลือกสี —</option>`;
  }
  const matched = colors.some((c) => (c.id || c.label) === selected || c.label === selected);
  const opts = colors.map((c) => {
    const val = c.id || c.label || '';
    const isSel = val === selected || c.label === selected;
    return `<option value="${escHtml(val)}" ${isSel ? 'selected' : ''}>${escHtml(c.label || val)}</option>`;
  });
  // Preserve a stored colour that's no longer in the product's list so
  // editing a row doesn't silently re-write it.
  if (selected && selected !== 'default' && !matched) {
    opts.unshift(`<option value="${escHtml(selected)}" selected>${escHtml(selected)}</option>`);
  }
  return opts.join('');
}


/** Per-item fulfilment status chips inside the order detail. Each chip
 *  writes immediately (data-item-status + data-item-id wired in
 *  openOrderModal). The preorder/normal flag is edited inside
 *  "แก้ไขรายการสินค้า" — not here — so there's a single place for it. */
function itemStatusControlsHtml(it) {
  const cur = it.item_status || 'paid';
  const chip = (s, extra = '') => `
    <button type="button" class="chip chip-sm ${cur === s ? 'is-active' : ''} ${extra}"
            data-item-status="${escHtml(s)}" data-item-id="${escHtml(String(it.id))}">
      ${escHtml(itemStatusMeta(s).short || itemStatusMeta(s).label)}
    </button>`;
  return `
    <div class="item-status-controls">
      <span class="isc-label">ความคืบหน้า</span>
      <div class="isc-chips">
        ${ITEM_FULFIL_STAGES.map((s) => chip(s)).join('')}
        ${ITEM_ISSUE_STAGES.map((s) => chip(s, `chip-tone-${STAGES_META[s].tone || 'warning'}`)).join('')}
      </div>
    </div>`;
}

/** Two <option>s for a preorder/normal selector. */
function preorderOptionsHtml(isPreorder) {
  return `
    <option value="false" ${isPreorder ? '' : 'selected'}>พร้อมส่ง</option>
    <option value="true" ${isPreorder ? 'selected' : ''}>พรีออเดอร์</option>`;
}

/** Inline editor for an order's line items: each existing row is fully
 *  editable (ไซส์ / สี / จำนวน / ราคา / ประเภท) behind a per-row Save,
 *  plus an add form with the same fields. Totals recompute and stock
 *  reflects automatically (reserved aggregates derive from these rows). */
function editItemsPanelHtml(o, productMap) {
  const items = (Array.isArray(o.items) ? o.items : []).filter(Boolean);
  const products = (state.products || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const field = (label, control, cls = '') => `
    <label class="eir-f ${cls}"><span>${escHtml(label)}</span>${control}</label>`;
  return `
    <div class="edit-items-panel mt-2">
      <div class="small text-muted mb-2">
        <i class="bi bi-info-circle me-1"></i>แก้ไขไซส์ / สี / จำนวน / ราคา / ประเภท แล้วกดบันทึกรายการนั้น · มีผลกับสต็อก
      </div>
      ${items.map((it) => {
        const p = productMap.get(it.product_id);
        return `
        <div class="edit-item-row" data-edit-row="${escHtml(String(it.id))}">
          <div class="eir-name">${escHtml(p?.name || it.product_id)}</div>
          <div class="eir-actions">
            <button type="button" class="btn btn-shop btn-sm" data-save-item data-item-id="${escHtml(String(it.id))}" title="บันทึกรายการนี้">
              <i class="bi bi-save"></i>
            </button>
            <button type="button" class="btn btn-outline-danger btn-sm"
                    data-remove-item data-item-id="${escHtml(String(it.id))}" title="ลบรายการ">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
          <div class="eir-fields">
            ${field('ไซส์', `<select class="form-select form-select-sm" data-edit-size>${variantSizeOptionsHtml(p, it.size)}</select>`)}
            ${field('สี', `<select class="form-select form-select-sm" data-edit-color>${variantColorOptionsHtml(p, it.color)}</select>`)}
            ${field('จำนวน', `<input type="number" min="1" max="99" value="${Number(it.qty) || 1}" class="form-control form-control-sm" data-edit-qty />`)}
            ${field('ราคา/ชิ้น', `<input type="number" min="0" value="${Number(it.unit_price) || 0}" class="form-control form-control-sm" data-edit-price />`)}
            ${field('ประเภท', `<select class="form-select form-select-sm" data-edit-preorder>${preorderOptionsHtml(!!it.is_preorder)}</select>`)}
          </div>
        </div>`;
      }).join('')}

      <div class="add-item-form mt-3">
        <div class="small fw-bold mb-2"><i class="bi bi-plus-circle me-1"></i>เพิ่มสินค้า</div>
        <div class="eir-fields">
          ${field('สินค้า', `<select class="form-select form-select-sm" data-add-product>
              ${products.map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`).join('')}
            </select>`, 'eir-wide')}
          ${field('ไซส์', `<select class="form-select form-select-sm" data-add-size>${variantSizeOptionsHtml(products[0])}</select>`)}
          ${field('สี', `<select class="form-select form-select-sm" data-add-color>${variantColorOptionsHtml(products[0])}</select>`)}
          ${field('จำนวน', `<input type="number" min="1" max="99" value="1" class="form-control form-control-sm" data-add-qty />`)}
          ${field('ราคา/ชิ้น', `<input type="number" min="0" class="form-control form-control-sm" data-add-price placeholder="${products[0] ? `auto (฿${effectivePrice(products[0])})` : 'auto'}" />`)}
          ${field('ประเภท', `<select class="form-select form-select-sm" data-add-preorder>${preorderOptionsHtml(!!products[0]?.is_presale)}</select>`)}
        </div>
        <button type="button" class="btn btn-shop btn-sm mt-2" data-add-item-btn>
          <i class="bi bi-plus-lg me-1"></i> เพิ่มเข้าคำสั่งซื้อ
        </button>
      </div>
    </div>`;
}

function orderModalBodyHtml(o) {
  // Defensive: items array may contain stale references when an old
  // order's product was renamed. Filter null/undefined entries and
  // look up the name from state.products so the admin sees something
  // human-readable instead of "p-shirtttest-685".
  const items = (Array.isArray(o.items) ? o.items : []).filter(Boolean);
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  const buyerName  = o.buyer_name  || o.buyer_label || '—';
  const buyerEmail = o.buyer_email || '';
  const pieces = items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const phoneDigits = String(o.buyer_phone || '').replace(/[^0-9+]/g, '');
  const history = orderHistory(o, state.products);
  return `
    <div class="om-summary">
      ${rowStatusPill(rollupOrderStage(o))}
      <span><i class="bi bi-calendar3 me-1" aria-hidden="true"></i>สั่งเมื่อ ${escHtml(fmtDateTime(o.placed_at))}</span>
      <span>${thb(pieces)} ชิ้น · <b>฿${thb(o.total)}</b></span>
      ${items.some((it) => it.is_preorder) ? '<span class="preorder-tag">พรีออเดอร์</span>' : ''}
      ${o.pickup_location ? `<span><i class="bi bi-geo-alt me-1" aria-hidden="true"></i>รับที่ ${escHtml(findPickupLocation(o.pickup_location)?.label || o.pickup_location)}</span>` : ''}
    </div>
    <div class="row g-3">
      <div class="col-md-7">
        <h5>ลูกค้า</h5>
        <div class="p-3 bg-light rounded mb-3">
          <div style="font-weight:600;">${escHtml(buyerName)}</div>
          ${buyerEmail ? `
            <div class="small mt-1">
              <i class="bi bi-envelope me-1 text-muted"></i>
              <a href="mailto:${escHtml(buyerEmail)}" class="text-decoration-none">${escHtml(buyerEmail)}</a>
            </div>` : '<div class="small text-muted mt-1"><i class="bi bi-envelope-slash me-1"></i>ไม่มีอีเมล</div>'}
          ${phoneDigits ? `
            <div class="small mt-1">
              <i class="bi bi-telephone me-1 text-muted"></i>
              <a href="tel:${escHtml(phoneDigits)}" class="text-decoration-none">${escHtml(o.buyer_phone)}</a>
            </div>` : ''}
        </div>

        <h5>รายการสินค้า</h5>
        ${items.map((it) => {
          const product = productMap.get(it.product_id);
          const displayName = product?.name || it.product_id || '(สินค้าถูกลบ)';
          const colorLabel = colorLabelFor(product, it.color);
          return `
          <div class="order-item-line">
            <div class="oil-top">
              <div class="oil-info">
                <div class="oil-name">
                  ${escHtml(displayName)}
                  ${it.is_preorder ? '<span class="preorder-tag ms-1">พรีออเดอร์</span>' : ''}
                </div>
                <div class="oil-variant">
                  ${it.size && it.size !== 'F' ? `ไซส์ ${escHtml(it.size)}` : 'Unisex'}
                  ${colorLabel ? ` · ${escHtml(colorLabel)}` : ''}
                  ${(() => {
                    // Not recorded on the order (pickup_location is empty on
                    // every web order), so this is the product's setting NOW —
                    // said as such, since it may have changed since the sale.
                    if (o.pickup_location) return '';
                    const pk = findPickupLocation(product?.pickup_location_id);
                    return pk ? ` · <i class="bi bi-geo-alt" aria-hidden="true"></i> จุดรับตอนนี้: ${escHtml(pk.label)}` : '';
                  })()}
                </div>
              </div>
              <div class="oil-qty">× ${it.qty}</div>
              <div class="oil-price">฿${thb((Number(it.unit_price) || 0) * (Number(it.qty) || 0))}</div>
            </div>
            ${it.id != null ? itemStatusControlsHtml(it) : ''}
          </div>`;
        }).join('')}
        <div class="d-flex justify-content-between mt-3" style="font-size:1.1rem; font-weight:700;">
          <span>ยอดรวม</span>
          <span style="color:var(--shop-700);">฿${thb(o.total)}</span>
        </div>

        <button type="button" class="btn btn-outline-secondary btn-sm mt-2" data-toggle-edit-items>
          <i class="bi bi-pencil-square me-1"></i> ${modalEditItems ? 'เสร็จสิ้นการแก้ไข' : 'แก้ไขรายการสินค้า'}
        </button>
        ${modalEditItems ? editItemsPanelHtml(o, productMap) : ''}

        ${o.buyer_note ? `<h5 class="mt-4">หมายเหตุจากลูกค้า</h5><div class="small bg-light rounded p-2">${escHtml(o.buyer_note)}</div>` : ''}

        <h5 class="mt-4">ประวัติ</h5>
        ${history.length ? `
          <ol class="om-history">
            ${history.map((e) => `
              <li data-stage="${escHtml(e.stage)}">
                <span class="om-h-time">${e.at ? escHtml(fmtDateTime(e.at)) : '—'}</span>
                <span class="om-h-what"><b>${escHtml(e.label)}</b>${e.what ? ` <span class="text-muted">· ${escHtml(e.what)}</span>` : ''}${e.by ? ` <span class="text-muted">· โดย${escHtml(actorLabel(e.by))}</span>` : ''}</span>
              </li>`).join('')}
          </ol>` : '<p class="small text-muted">ยังไม่มีประวัติ</p>'}
      </div>
      <div class="col-md-5">
        <h5>สลิปการโอน${(() => { const n = orderSlipList(o).length; return n > 1 ? ` (${n})` : ''; })()}</h5>
        ${slipThumbsHtml(o)}

        <h5>สถานะการชำระเงิน</h5>
        <p class="small text-muted mb-2">
          ระยะการชำระเงินของทั้งคำสั่งซื้อ — ความคืบหน้าการผลิต/รับสินค้าตั้งค่าแยกรายสินค้าด้านซ้าย
        </p>
        <div class="d-flex flex-wrap gap-2">
          ${PAYMENT_STAGES.map((s) => `
            <button type="button" class="chip ${o.status === s ? 'is-active' : ''}" data-set-status="${s}">
              <i class="bi ${escHtml(STAGES_META[s].icon)}"></i> ${escHtml(STAGES_META[s].label)}
            </button>`).join('')}
        </div>

        <h5 class="mt-3">สถานะปัญหา</h5>
        <div class="d-flex flex-wrap gap-2">
          ${ORDER_ISSUE_STATUSES.map((s) => {
            const tone = STAGES_META[s].tone || 'warning';
            return `
            <button type="button" class="chip chip-tone-${escHtml(tone)} ${o.status === s ? 'is-active' : ''}" data-set-status="${s}">
              <i class="bi ${escHtml(STAGES_META[s].icon)}"></i> ${escHtml(STAGES_META[s].label)}
            </button>`;
          }).join('')}
        </div>

        <h5 class="mt-3">หมายเหตุสำหรับลูกค้า</h5>
        <p class="small text-muted mb-1">ข้อความนี้จะแสดงในหน้า "คำสั่งซื้อ" ของลูกค้า</p>
        <textarea id="shopAdminOrderModalCustomerNote" class="form-control shop-autogrow" rows="2"
          placeholder="เช่น โอนเกินมา 20 บาท เดี๋ยวคืนให้ในรอบรับสินค้า — บันทึกเมื่อปิดหน้านี้">${escHtml(o.customer_note || '')}</textarea>

        <h5 class="mt-3">หมายเหตุภายใน admin</h5>
        <textarea id="shopAdminOrderModalNote" class="form-control shop-autogrow" rows="3"
          placeholder="ระบุหมายเหตุ — บันทึกเมื่อปิดหน้านี้">${escHtml(o.admin_note || '')}</textarea>
      </div>
    </div>`;
}

/** Persist the internal admin note AND the customer-facing note on modal
 *  close. Each is only written when its text actually changed; both ride
 *  in one PATCH when both changed. */
export async function persistAdminNoteIfChanged() {
  // Captured: the modal is closing, and by the time the PATCH returns the admin
  // may have opened ANOTHER order — whose notes this must never touch, and whose
  // `modalOrder` this must never clear.
  const order = modalOrder;
  if (!order) return;
  const noteEl = document.getElementById('shopAdminOrderModalNote');
  const custEl = document.getElementById('shopAdminOrderModalCustomerNote');
  const body = {};
  if (noteEl && noteEl.value !== (order.admin_note || '')) body.admin_note = noteEl.value;
  if (custEl && custEl.value !== (order.customer_note || '')) body.customer_note = custEl.value;
  modalOrder = null;
  if (Object.keys(body).length === 0) return;
  try {
    const idEsc = encodeURIComponent(order.id);
    // return=representation + a row check: a refused PATCH answers 204 with no
    // error, and the customer note is something the BUYER reads.
    const { data, error } = await dbRest(
      `/shop_orders?id=eq.${idEsc}`,
      { method: 'PATCH', body, prefer: 'return=representation' },
    );
    if (error) throw new Error(error.message || 'บันทึกหมายเหตุไม่สำเร็จ');
    if (!Array.isArray(data) || data.length === 0) throw new Error('ไม่มีสิทธิ์แก้ไขคำสั่งซื้อนี้');
    // The whole returned row, not just the notes: the write bumped updated_at,
    // and the verify queue refuses an order whose updated_at it did not see.
    const row = state.orders.find((x) => x.id === order.id);
    if (row) Object.assign(row, data[0]);
  } catch (e) {
    console.warn('[shop/admin] persistAdminNote failed:', e);
    showShopToast(`บันทึกหมายเหตุของ ${order.id} ไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

