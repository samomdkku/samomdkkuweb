// ==============================================
// SHOP ADMIN — Orders, slip verify, preorder demand, batches, products, QR
//
// Mounted inside #adminShopSection within tab-admin.html. Driven by the
// existing openAdminSection('shop') hook (added in main.js).
// ==============================================

import { escHtml, safeUrl, orderIdChipHtml } from '../utils.js';
import { dbRest } from '../db.js';
import { getUser } from '../auth.js';
import {
  thb, fmtDate, fmtDateTime, STAGES_META, ORDER_ISSUE_STATUSES,
  SHOP_SOURCES, findSource, slugify, sanitizeOrderCode,
  STOCK_STATUSES, STOCK_STATUS_META, stockKey, totalStock,
  batchDateEntries, ITEM_STAGES_ORDER, rollupOrderStage, itemStatusMeta,
  effectivePrice, unitPriceFor, priceRange,
  getShopTypes, setShopTypes, getPromptpayQrs, setPromptpayQrs,
  getPickupLocations, setPickupLocations,
} from './data.js';
import {
  listAllOrders, getOrder, updateOrderStatus, deleteOrder, setOrderItemStatus,
  addOrderItem, updateOrderItem, removeOrderItem, recomputeOrderTotals, adminCreateOrder,
  listProducts, upsertProduct, deleteProduct, archiveProduct, applyProductProductionStatus,
  listAllBatches, upsertBatch, closeBatch,
  getSettings, saveSettings,
  listShopBanners, createShopBanner, updateShopBanner, deleteShopBanner, reorderShopBanners,
  listProductTypes, upsertProductType, deleteProductType,
  listPromptpayQrs, upsertPromptpayQr, deletePromptpayQr, setDefaultQr,
  listPickupLocations, upsertPickupLocation, deletePickupLocation,
} from './api.js';
import { uploadShopFile, deleteShopFile } from './uploads.js';
import { convertDriveUrl } from '../uploads.js';
import { showShopToast } from './products.js';
import { invalidateSettingsCache } from './checkout.js';

const state = {
  tab: 'orders',
  orders: [],
  products: [],
  batches: [],
  settings: null,
  // Multi-select facet filters. Empty Set = "all" for that facet.
  // Within a facet → OR; across facets → AND. This is the standard
  // faceted-filter pattern (Shopify/Stripe/Linear/Notion).
  ordersStatuses: new Set(),
  ordersProducts: new Set(),   // specific product ids (subtype level)
  ordersTypes: new Set(),      // product-type ids, e.g. 'apparel-shirt' (type level)
  ordersSizes: new Set(),      // size strings, e.g. 'S' (default-key 'F')
  ordersColors: new Set(),     // color ids, e.g. 'black' (default-key 'default')
  ordersItemStatuses: new Set(), // per-item effective progress (rowDisplayStatus)
  ordersSources: new Set(),    // แหล่งที่มา (owning dept) — item-level; matches on product_source
  ordersSelected: new Set(),   // order ids ticked for bulk delete
  ordersSearch: '',
  // 'all' | 'preorder' | 'in_stock' — gates the orders table on the
  // shop_orders.is_preorder flag set by place_shop_order (mig 0030).
  ordersPreorder: 'all',
  orderCreateDraft: null,  // admin "create order" inline panel state
  verifyIdx: 0,
  productEditor: null,
  batchEditor: null,
  // Catalog-config managers (migration 0057). Lists mirror the data.js
  // caches; *Editor holds the inline add/edit draft (null = closed).
  productTypes: [],
  promptpayQrs: [],
  pickupLocations: [],
  typeEditor: null,
  qrEditor: null,
  pickupEditor: null,
  // Preorder tab
  preorderExpanded: new Set(),  // `${productId}` keys expanded to show orders
  preorderView: 'table',        // 'table' | 'cards'
  preorderSearch: '',
  preorderType: 'all',          // SHOP_TYPES id or 'all'
  // Stock tab
  stockSearch: '',
  stockEdits: new Map(),  // productId → { matrix: {...}, status: '...' }  (pending unsaved edits)
  // Banners tab — which placement set is being managed (mig 0037).
  // 'launch' = เปิดตัวล่าสุด hero · 'announcement' = ประกาศ carousel.
  bannerPlacement: 'launch',
};

// ---------------------------------------------------------------------
// Per-user default แหล่งที่มา (source/owning-dept) filter for the orders
// page. Persisted in localStorage keyed by user id, so each admin — and
// each account switched-to on a shared device (account-switcher) — keeps
// its own default. Empty / no key = show all sources. Applied once per
// session on the first orders load; the admin can still change the live
// filter freely afterward without disturbing the saved default.
// ---------------------------------------------------------------------
let sourceDefaultAppliedUid = null;
function sourceDefaultKey() {
  return `samoshop.admin.orderSourceDefault.${getUser()?.id || 'anon'}`;
}
function loadSourceDefault() {
  try {
    const raw = localStorage.getItem(sourceDefaultKey());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}
function saveSourceDefault(arr) {
  try {
    if (!arr || arr.length === 0) localStorage.removeItem(sourceDefaultKey());
    else localStorage.setItem(sourceDefaultKey(), JSON.stringify(arr));
  } catch { /* private-mode / quota — non-fatal */ }
}
/** Apply the signed-in admin's saved default into the live filter — once
 *  per user id. Defers (stays retryable) until getUser() resolves, and
 *  RE-applies (resetting the filter to the new account's default) when the
 *  account changes via the account-switcher without a page reload. A no-op
 *  on repeat calls for the same user, so manual filter tweaks made during
 *  the session are preserved. */
function applySourceDefaultOnce() {
  const uid = getUser()?.id;
  if (!uid || uid === sourceDefaultAppliedUid) return;
  sourceDefaultAppliedUid = uid;
  state.ordersSources = new Set(loadSourceDefault());
}

let mounted = false;
function ensureMounted() {
  if (mounted) return;
  mounted = true;
  applySourceDefaultOnce();

  // Tab switcher
  document.getElementById('shopAdminTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-admin-tab]');
    if (!btn) return;
    setTab(btn.dataset.shopAdminTab);
  });

  // Multi-select status facet — populated once from STAGES_META.
  populateStatusFacet();
  populateOrdersSourceFacet();
  // Search box — searches id, buyer name, and buyer email.
  const search = document.getElementById('shopAdminOrdersSearch');
  if (search) {
    search.addEventListener('input', () => { state.ordersSearch = search.value.toLowerCase(); renderOrdersTable(); });
  }
  // Preorder tri-state filter (all / preorder-only / in-stock-only).
  document.getElementById('shopAdminOrdersPreorderGroup')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-orders-preorder]');
    if (!btn) return;
    state.ordersPreorder = btn.dataset.ordersPreorder;
    document.querySelectorAll('#shopAdminOrdersPreorderGroup [data-orders-preorder]')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.ordersPreorder === state.ordersPreorder));
    repopulateOrderFacets();
    renderOrdersTable();
  });

  // Clear-all chip.
  document.getElementById('shopAdminOrdersClearFilters')?.addEventListener('click', () => {
    state.ordersStatuses.clear();
    state.ordersProducts.clear();
    state.ordersTypes.clear();
    state.ordersSizes.clear();
    state.ordersColors.clear();
    state.ordersItemStatuses.clear();
    state.ordersSources.clear();
    state.ordersSearch = '';
    state.ordersPreorder = 'all';
    const s = document.getElementById('shopAdminOrdersSearch'); if (s) s.value = '';
    document.querySelectorAll('#shopAdminOrdersPreorderGroup [data-orders-preorder]')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.ordersPreorder === 'all'));
    populateStatusFacet();           // re-render checks
    populateOrdersSourceFacet();
    populateOrdersProductSelect();   // re-render checks
    populateOrdersSizeFacet();
    populateOrdersColorFacet();
    populateOrdersItemStatusFacet();
    renderOrdersTable();
  });
  document.getElementById('shopAdminOrdersRefresh')?.addEventListener('click', refreshOrders);
  document.getElementById('shopAdminOrdersCreate')?.addEventListener('click', toggleOrderCreate);
  // CSV export — see exportOrdersCsv below.
  document.getElementById('shopAdminOrdersExport')?.addEventListener('click', exportOrdersCsv);

  // Open the camera scanner. On a successful scan, jump straight to the
  // order's detail modal if it exists in the loaded list; otherwise
  // refresh + retry (the order might be newer than the last load).
  document.getElementById('shopAdminOrdersScan')?.addEventListener('click', async () => {
    const { openScannerModal } = await import('./qr.js');
    openScannerModal(async (id) => {
      const found = state.orders.find((o) => o.id === id);
      if (found) { openOrderModal(id); return; }
      await refreshOrders();
      const retry = state.orders.find((o) => o.id === id);
      if (retry) openOrderModal(id);
      else showShopToast(`ไม่พบคำสั่งซื้อ ${id}`, 'warn');
    });
  });

  // Orders click → modal
  document.getElementById('shopAdminOrdersTbody')?.addEventListener('click', (e) => {
    // The order-id chip's copy button lives INSIDE the clickable row.
    // The global [data-copy] delegate is on `document`, so it fires AFTER
    // this tbody listener in the bubble path — too late to stopPropagation.
    // Skip the row-click ourselves when the chip was the actual target.
    if (e.target.closest('[data-copy]')) return;
    // The per-order select checkbox also lives in a clickable row — a
    // tick must NOT open the detail modal.
    if (e.target.closest('[data-order-select]')) return;
    const tr = e.target.closest('[data-order-id]');
    if (!tr) return;
    openOrderModal(tr.dataset.orderId);
  });

  // Bulk-select: per-order checkbox, select-all, bulk delete.
  document.getElementById('shopAdminOrdersTbody')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-order-select]');
    if (!cb) return;
    if (cb.checked) state.ordersSelected.add(cb.dataset.orderSelect);
    else state.ordersSelected.delete(cb.dataset.orderSelect);
    syncBulkBar();
  });
  document.getElementById('shopAdminOrdersSelectAll')?.addEventListener('change', (e) => {
    const ids = filterOrders(state.orders).map((o) => o.id);
    if (e.target.checked) ids.forEach((id) => state.ordersSelected.add(id));
    else ids.forEach((id) => state.ordersSelected.delete(id));
    renderOrdersTable();
  });
  document.getElementById('shopAdminOrdersBulkClear')?.addEventListener('click', () => {
    state.ordersSelected.clear();
    renderOrdersTable();
  });
  document.getElementById('shopAdminOrdersBulkDelete')?.addEventListener('click', bulkDeleteSelectedOrders);

  // Auto-save the internal admin note when the modal closes.
  const orderModalEl = document.getElementById('shopAdminOrderModal');
  if (orderModalEl) {
    orderModalEl.addEventListener('hidden.bs.modal', persistAdminNoteIfChanged);
  }

  // Batches
  document.getElementById('shopAdminBatchesNew')?.addEventListener('click', () => {
    state.batchEditor = blankBatch();
    renderBatches();
  });

  // Products
  document.getElementById('shopAdminProductsNew')?.addEventListener('click', () => {
    state.productEditor = blankProduct();
    renderProductEditor();
  });

  // Banners
  wireBanners();

  // QR Settings save
  document.getElementById('shopAdminQRSave')?.addEventListener('click', saveSettingsForm);
  document.getElementById('shopAdminQRFile')?.addEventListener('change', onQRFileChosen);

  // Preorder demand refresh
  document.getElementById('shopAdminPreorderRefresh')?.addEventListener('click', refreshPreorder);
  // Preorder toolbar: search (content only re-render keeps input focus),
  // type chips, and card/table view toggle.
  document.getElementById('shopAdminPreorderSearch')?.addEventListener('input', (e) => {
    state.preorderSearch = e.target.value || '';
    renderPreorder();
  });
  document.getElementById('shopAdminPreorderTypes')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-preorder-type]');
    if (!chip) return;
    state.preorderType = chip.dataset.preorderType;
    renderPreorder();
  });
  document.getElementById('shopAdminPreorderViewToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preorder-view]');
    if (!btn) return;
    state.preorderView = btn.dataset.preorderView;
    document.querySelectorAll('#shopAdminPreorderViewToggle [data-preorder-view]')
      .forEach((b) => b.classList.toggle('active', b.dataset.preorderView === state.preorderView));
    renderPreorder();
  });

  // Stock tab search + refresh
  const stockSearch = document.getElementById('shopAdminStockSearch');
  if (stockSearch) {
    stockSearch.addEventListener('input', () => {
      state.stockSearch = stockSearch.value.trim().toLowerCase();
      renderStock();
    });
  }
  document.getElementById('shopAdminStockRefresh')?.addEventListener('click', refreshStock);
}

function setTab(name) {
  state.tab = name;
  document.querySelectorAll('#shopAdminTabs [data-shop-admin-tab]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.shopAdminTab === name));
  document.querySelectorAll('#adminShopSection [data-shop-admin-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.shopAdminPane !== name));

  if (name === 'orders')   refreshOrders();
  if (name === 'verify')   renderVerifyQueue();
  if (name === 'preorder') refreshPreorder();
  if (name === 'batches')  refreshBatches();
  if (name === 'banners')  refreshBanners();
  if (name === 'products') refreshProducts();
  if (name === 'stock')    refreshStock();
  if (name === 'qr')       { loadSettingsIntoForm(); refreshQrList(); }
  if (name === 'catalog')  refreshCatalog();
}

/** Entry point — call from main.js when the shop admin section opens. */
export async function openShopAdmin() {
  ensureMounted();
  // Load the catalog-config lists (types / QRs / pickup) into the data.js
  // caches so the product editor's selects + the customer surfaces have
  // them. Best-effort — a missing 0057 migration just yields empty lists.
  await refreshCatalogConfig();
  setTab(state.tab || 'orders');
}

/** Fetch the catalog-config lists into both admin state and the shared
 *  data.js caches. Reused by the managers after every mutation. */
async function refreshCatalogConfig() {
  const [types, qrs, pickups] = await Promise.all([
    listProductTypes({ activeOnly: false }).catch(() => []),
    listPromptpayQrs({ activeOnly: false }).catch(() => []),
    listPickupLocations({ activeOnly: false }).catch(() => []),
  ]);
  state.productTypes = types;
  state.promptpayQrs = qrs;
  state.pickupLocations = pickups;
  setShopTypes(types);
  setPromptpayQrs(qrs);
  setPickupLocations(pickups);
}

/** Deep-link target: open a specific order's detail modal. Used by the
 *  /admin/?scan=<id> URL handler in admin-main.js. Lazily mounts the
 *  admin module, switches to the orders tab, narrows the visible table
 *  to just this order so the background pane matches the modal, then
 *  opens the modal. */
export async function openShopAdminOrder(orderId) {
  if (!orderId) return;
  ensureMounted();
  setTab('orders');
  // Narrow the orders table to this single row so the pane behind the
  // modal is obviously about THIS order. Search-filter is case-
  // insensitive over id + buyer fields; the order id matches exactly.
  state.ordersSearch = String(orderId).toLowerCase();
  const searchInput = document.getElementById('shopAdminOrdersSearch');
  if (searchInput) searchInput.value = orderId;
  if (!state.orders.find((o) => o.id === orderId)) {
    await refreshOrders();
  } else {
    renderOrdersTable();   // refresh facet pills + filtered row count
  }
  if (state.orders.find((o) => o.id === orderId)) {
    openOrderModal(orderId);
  } else {
    showShopToast(`ไม่พบคำสั่งซื้อ ${orderId}`, 'warn');
  }
}

// ---------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------
async function refreshOrders() {
  try {
    // Pull products in parallel — the product filter dropdown needs the
    // current list, and the bulk-advance bar resolves labels from it.
    const [orders, products] = await Promise.all([
      listAllOrders(),
      (!state.products || state.products.length === 0)
        ? listProducts({ activeOnly: false }).catch(() => [])
        : Promise.resolve(state.products),
    ]);
    state.orders = orders;
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
    renderStats();
    renderOrdersTable();
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
  for (const o of (state.orders || [])) {
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
  for (const o of (state.orders || [])) {
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
function repopulateOrderFacets() {
  populateStatusFacet();
  populateOrdersSourceFacet();
  populateOrdersProductSelect();
  populateOrdersSizeFacet();
  populateOrdersColorFacet();
  populateOrdersItemStatusFacet();
}

function populateStatusFacet() {
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
function populateOrdersSourceFacet() {
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

function populateOrdersProductSelect() {
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

function populateOrdersSizeFacet() {
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

function populateOrdersColorFacet() {
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

function populateOrdersItemStatusFacet() {
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

function renderStats() {
  const host = document.getElementById('shopAdminStats');
  if (!host) return;
  // Trimmed to the two cards admins actually act on: slip review (the
  // only one with a daily SLA) and cumulative revenue. Production /
  // ready counts have their own filter pills below and were just
  // visual noise here.
  const review = state.orders.filter((o) => o.status === 'review').length;
  const revenue = state.orders
    .filter((o) => o.status !== 'pending' && o.status !== 'cancel')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  host.innerHTML = `
    <div class="stat-card is-warning">
      <div class="stat-label">รอตรวจสลิป</div>
      <div class="stat-value">${review}<span class="stat-suffix">รายการ</span></div>
      <div class="stat-delta" style="color:var(--status-cancel)">รอจัดการ</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">รายรับสะสม (ไม่รวมยกเลิก/รอชำระ)</div>
      <div class="stat-value">฿${thb(revenue)}</div>
    </div>`;
}

/** Per-row display status: before payment the whole-order status is
 *  authoritative (pending/review/off-path/legacy); once paid each row
 *  shows its own item_status. */
function rowDisplayStatus(o, it) {
  const s = o.status || 'pending';
  if (s !== 'paid') return s;
  return it ? (it.item_status || 'paid') : 'paid';
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

function renderOrdersTable() {
  const tbody = document.getElementById('shopAdminOrdersTbody');
  if (!tbody) return;
  const list = filterOrders(state.orders);
  const countEl = document.getElementById('shopAdminOrdersCount');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">ไม่มีรายการ</td></tr>`;
    if (countEl) countEl.textContent = 'แสดง 0 รายการสินค้า · 0 ชิ้น · 0 คำสั่งซื้อ';
    syncBulkBar();
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
      <td rowspan="${span}" class="order-group-cell text-center">
        <input type="checkbox" class="form-check-input" data-order-select="${escHtml(o.id)}"
               ${state.ordersSelected.has(o.id) ? 'checked' : ''} title="เลือกคำสั่งซื้อ" />
      </td>`;
    const orderCell = `
      <td rowspan="${span}" class="order-group-cell">
        <div class="order-id">${orderIdChipHtml(o.id)}</div>
        <div class="small text-muted text-nowrap">${fmtDate(o.placed_at)}</div>
        <div class="small text-nowrap" style="font-weight:600;">฿${thb(o.total)}</div>
      </td>
      <td rowspan="${span}" class="order-group-cell">
        <div style="font-weight:600;">${escHtml(buyerName)}</div>
        ${buyerEmail ? `<div class="small text-muted">${escHtml(buyerEmail)}</div>` : ''}
        ${o.buyer_phone ? `<div class="small text-muted"><i class="bi bi-telephone me-1"></i>${escHtml(o.buyer_phone)}</div>` : ''}
      </td>`;
    const slipCell = `
      <td rowspan="${span}" class="order-group-cell">
        ${(o.slip_url || (Array.isArray(o.slips) && o.slips.length))
          ? `<span class="text-success small text-nowrap"><i class="bi bi-check-circle-fill me-1"></i>ส่งแล้ว${Array.isArray(o.slips) && o.slips.length > 1 ? ` (${o.slips.length})` : ''}</span>`
          : `<span class="text-muted small text-nowrap"><i class="bi bi-dash-circle me-1"></i>ยังไม่ส่ง</span>`}
      </td>`;
    const chevronCell = `<td rowspan="${span}" class="order-group-cell"><i class="bi bi-chevron-right"></i></td>`;

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
          <td>
            <div class="small" style="font-weight:600;">
              ${escHtml(name)}
              ${it?.is_preorder ? '<span class="preorder-tag ms-1">พรีออเดอร์</span>' : ''}
            </div>
            ${variant ? `<div class="small text-muted">${escHtml(variant)}</div>` : ''}
            ${sourceTag}
          </td>
          <td><span style="font-weight:700;">${it ? `× ${Number(it.qty) || 0}` : '—'}</span></td>
          <td><span style="font-weight:600;">฿${thb(lineTotal)}</span></td>
          ${idx === 0 ? slipCell : ''}
          <td>${rowStatusPill(status)}</td>
          ${idx === 0 ? chevronCell : ''}
        </tr>`;
    }).join('');
  }).join('');

  if (countEl) {
    countEl.textContent = `แสดง ${lineCount} รายการสินค้า · ${qtyTotal} ชิ้น · ${list.length} คำสั่งซื้อ`;
  }
  syncBulkBar();
}

/** Reflect the current selection into the bulk action bar + the
 *  select-all header checkbox (checked / indeterminate / clear). */
function syncBulkBar() {
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
async function bulkDeleteSelectedOrders() {
  const ids = [...state.ordersSelected];
  if (ids.length === 0) return;
  if (!confirm(`ลบ ${ids.length} คำสั่งซื้อถาวร? ไม่สามารถกู้คืนได้`)) return;
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
function itemVariantLabel(p, it) {
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
function toggleOrderCreate() {
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
function filterOrders(source) {
  const statuses = state.ordersStatuses;
  const q = (state.ordersSearch || '').trim();
  const itemFacetActive = anyItemFacetActive();
  return (source || []).filter((o) => {
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

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  // RFC4180: quote when the cell contains comma, quote, newline; double
  // up internal quotes. Always quote so partial files still parse if
  // the data later contains a delimiter.
  return `"${s.replace(/"/g, '""')}"`;
}

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
      head: [o.id, o.placed_at || '', o.updated_at || '',
             o.status || '', STAGES_META[o.status]?.label || o.status || '',
             o.is_preorder ? 'yes' : 'no'],
      buyer: [o.buyer_name || '', o.buyer_email || '', o.buyer_phone || '',
              o.buyer_label || '', o.buyer_id || ''],
      money: [o.subtotal || 0, o.fee || 0, o.total || 0],
      fulfil: [slipCount, o.slip_url || '', o.slip_uploaded_at || '',
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

function exportOrdersCsv() {
  const list = filterOrders(state.orders);
  if (list.length === 0) {
    showShopToast('ไม่มีรายการในตัวกรองปัจจุบัน', 'warn');
    return;
  }
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  const csv = ordersToCsv(list, productMap);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
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

let modalOrder = null;
let modalEditItems = false;    // line-item edit mode toggle
function openOrderModal(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) return;
  modalOrder = o;
  modalEditItems = false;
  const idEl = document.getElementById('shopAdminOrderModalId');
  const body = document.getElementById('shopAdminOrderModalBody');
  if (idEl) idEl.textContent = String(o.id);
  if (body) body.innerHTML = orderModalBodyHtml(o);

  wireOrderModalBody(body);

  // Status chips now write immediately (no staged Save bar). Only the
  // Delete button needs footer wiring.
  document.getElementById('shopAdminOrderModalDelete')?.addEventListener('click', deleteCurrentOrder);

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
    await reloadModalOrderFromServer();
    if (state.tab === 'verify') renderVerifyQueue();
    if (state.tab === 'preorder') refreshPreorder();
  } catch (e) {
    console.error('[shop/admin] status update failed:', e);
    showShopToast(`อัปเดตล้มเหลว: ${e?.message || e}`, 'error');
  }
}

async function reloadModalOrderFromServer() {
  if (!modalOrder) return;
  try {
    const fresh = await getOrder(modalOrder.id);
    if (fresh) {
      modalOrder = fresh;
      const idx = (state.orders || []).findIndex((x) => x.id === fresh.id);
      if (idx >= 0) state.orders[idx] = fresh;
    }
  } catch (e) {
    console.warn('[shop/admin] reload order failed:', e);
  }
  await repaintOrderModalBody();
  renderOrdersTable();
  renderStats();
}

/** Save all edits for one existing line item (ไซส์ / สี / จำนวน / ราคา /
 *  ประเภท) in a single PATCH, then recompute totals + reload. */
async function onSaveOrderItem(btn, body) {
  if (!modalOrder) return;
  const itemId = btn.dataset.itemId;
  const row = body.querySelector(`[data-edit-row="${CSS.escape(String(itemId))}"]`);
  const item = (modalOrder.items || []).find((i) => String(i.id) === String(itemId));
  if (!row || !item) return;
  const size = (row.querySelector('[data-edit-size]')?.value || 'F').trim() || 'F';
  const color = (row.querySelector('[data-edit-color]')?.value || 'default').trim() || 'default';
  const qty = Math.max(1, Math.min(99, Number(row.querySelector('[data-edit-qty]')?.value) || 1));
  const unitPrice = Math.max(0, Number(row.querySelector('[data-edit-price]')?.value) || 0);
  const isPreorder = row.querySelector('[data-edit-preorder]')?.value === 'true';
  btn.disabled = true;
  try {
    await updateOrderItem(itemId, { size, color, qty, unit_price: unitPrice, is_preorder: isPreorder });
    await recomputeOrderTotals(modalOrder.id);
    showShopToast('บันทึกรายการแล้ว', 'success');
    await reloadModalOrderFromServer();
    if (state.tab === 'preorder') refreshPreorder();
  } catch (e) {
    showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
    btn.disabled = false;
  }
}

async function onRemoveOrderItem(itemId) {
  if (!modalOrder || !itemId) return;
  const items = (modalOrder.items || []).filter(Boolean);
  if (items.length <= 1) {
    showShopToast('คำสั่งซื้อต้องมีสินค้าอย่างน้อย 1 รายการ — ลบทั้งคำสั่งซื้อแทน', 'warn');
    return;
  }
  if (!confirm('ลบรายการนี้ออกจากคำสั่งซื้อ?')) return;
  try {
    await removeOrderItem(itemId);
    await recomputeOrderTotals(modalOrder.id);
    showShopToast('ลบรายการแล้ว', 'success');
    await reloadModalOrderFromServer();
  } catch (e) {
    showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error');
  }
}

async function onAddOrderItem(body) {
  if (!modalOrder) return;
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
  if (!confirm(`เพิ่ม "${product?.name || productId}"${variant ? ` (${variant})` : ''} × ${qty} (฿${unitPrice}/ชิ้น) เข้าคำสั่งซื้อ?`)) return;
  const btn = body.querySelector('[data-add-item-btn]');
  if (btn) { btn.disabled = true; }
  try {
    await addOrderItem(modalOrder.id, {
      productId, size, color, qty, unitPrice,
      isPreorder,
      itemStatus: 'paid', // admin advances it per-item afterwards
    });
    await recomputeOrderTotals(modalOrder.id);
    showShopToast('เพิ่มสินค้าแล้ว', 'success');
    await reloadModalOrderFromServer();
  } catch (e) {
    showShopToast(`เพิ่มล้มเหลว: ${e.message || e}`, 'error');
    if (btn) btn.disabled = false;
  }
}

async function onItemStatusClick(btn, body) {
  if (!modalOrder) return;
  const itemId = btn.dataset.itemId;
  const status = btn.dataset.itemStatus;
  const item = (modalOrder.items || []).find((i) => String(i.id) === String(itemId));
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
    const row = state.orders.find((x) => x.id === modalOrder.id);
    const rowItem = row && (row.items || []).find((i) => String(i.id) === String(itemId));
    if (rowItem) { rowItem.item_status = updated.item_status; rowItem.item_timeline = updated.item_timeline; }
    showShopToast(`${modalOrder.id}: ${itemStatusMeta(status).label}`, 'success');
    // Repaint the modal body in place.
    body.innerHTML = orderModalBodyHtml(modalOrder);
    wireOrderModalBody(body);
    renderOrdersTable();
    renderStats();
  } catch (e) {
    console.error('[shop/admin] item status update failed:', e);
    showShopToast(`อัปเดตล้มเหลว: ${e?.message || e}`, 'error');
    rowChips.forEach((b) => { b.disabled = false; });
  }
}

async function deleteCurrentOrder() {
  if (!modalOrder) return;
  if (!confirm(`ลบคำสั่งซื้อ ${modalOrder.id} ถาวร? ไม่สามารถกู้คืนได้`)) return;
  const btn = document.getElementById('shopAdminOrderModalDelete');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังลบ…'; }
  try {
    await deleteOrder(modalOrder.id);
    showShopToast(`ลบคำสั่งซื้อ ${modalOrder.id} แล้ว`, 'success');
    const inst = window.bootstrap?.Modal.getInstance(document.getElementById('shopAdminOrderModal'));
    inst?.hide();
    modalOrder = null;
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
function orderSlipList(o) {
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
          <img src="${safeUrl(s.url)}" alt="slip" />
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

/** Map a stored colour id back to its product colour label. */
function colorLabelFor(product, colorId) {
  if (!colorId || colorId === 'default') return '';
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  const match = colors.find((c) => c && (c.id === colorId || c.label === colorId));
  return match?.label || colorId;
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
  return `
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
        <textarea id="shopAdminOrderModalCustomerNote" class="form-control" rows="2"
          placeholder="เช่น โอนเกินมา 20 บาท เดี๋ยวคืนให้ในรอบรับสินค้า — บันทึกเมื่อปิดหน้านี้">${escHtml(o.customer_note || '')}</textarea>

        <h5 class="mt-3">หมายเหตุภายใน admin</h5>
        <textarea id="shopAdminOrderModalNote" class="form-control" rows="3"
          placeholder="ระบุหมายเหตุ — บันทึกเมื่อปิดหน้านี้">${escHtml(o.admin_note || '')}</textarea>
      </div>
    </div>`;
}

/** Persist the internal admin note AND the customer-facing note on modal
 *  close. Each is only written when its text actually changed; both ride
 *  in one PATCH when both changed. */
async function persistAdminNoteIfChanged() {
  if (!modalOrder) return;
  const noteEl = document.getElementById('shopAdminOrderModalNote');
  const custEl = document.getElementById('shopAdminOrderModalCustomerNote');
  if (!noteEl && !custEl) { modalOrder = null; return; }
  const body = {};
  if (noteEl && noteEl.value !== (modalOrder.admin_note || '')) body.admin_note = noteEl.value;
  if (custEl && custEl.value !== (modalOrder.customer_note || '')) body.customer_note = custEl.value;
  if (Object.keys(body).length === 0) { modalOrder = null; return; }
  try {
    const idEsc = encodeURIComponent(modalOrder.id);
    const { error } = await dbRest(
      `/shop_orders?id=eq.${idEsc}`,
      { method: 'PATCH', body, prefer: 'return=minimal' },
    );
    if (error) throw new Error(error.message || 'บันทึกหมายเหตุไม่สำเร็จ');
    const row = state.orders.find((x) => x.id === modalOrder.id);
    if (row) Object.assign(row, body);
  } catch (e) {
    console.warn('[shop/admin] persistAdminNote failed:', e);
  } finally {
    modalOrder = null;
  }
}

// ---------------------------------------------------------------------
// Verify queue (one-at-a-time review)
// ---------------------------------------------------------------------
function renderVerifyQueue() {
  const host = document.getElementById('shopAdminVerifyHost');
  if (!host) return;
  const queue = state.orders.filter((o) => o.status === 'review');
  if (queue.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-check2-all"></i>
        <h4>ไม่มีสลิปรอตรวจ</h4>
        <p>ยอดเยี่ยม! ตามดูใหม่อีกครั้งเมื่อมีคำสั่งซื้อเข้า</p>
      </div>`;
    return;
  }
  const idx = Math.max(0, Math.min(state.verifyIdx, queue.length - 1));
  state.verifyIdx = idx;
  const current = queue[idx];
  const items = Array.isArray(current.items) ? current.items : [];

  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h5 class="font-prompt mb-0" style="font-weight:700;">ตรวจสลิปทีละรายการ</h5>
        <p class="text-muted mb-0 small">รายการ ${idx + 1} จาก ${queue.length}</p>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-ghost btn-sm" id="shopVerifyPrev" ${idx === 0 ? 'disabled' : ''}>
          <i class="bi bi-chevron-left"></i> ก่อนหน้า
        </button>
        <button class="btn btn-ghost btn-sm" id="shopVerifyNext" ${idx >= queue.length - 1 ? 'disabled' : ''}>
          ถัดไป <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </div>

    <div class="admin-detail-card">
      <div class="row g-3">
        <div class="col-md-6">
          <h5>สลิปที่อัปโหลด${(() => { const n = orderSlipList(current).length; return n > 1 ? ` (${n})` : ''; })()}</h5>
          ${slipThumbsHtml(current)}
        </div>
        <div class="col-md-6">
          <h5>เปรียบเทียบยอด</h5>
          <table class="table table-sm">
            <tbody>
              <tr><th class="text-muted" style="font-weight:500;">คำสั่งซื้อ</th><td>${escHtml(current.id)}</td></tr>
              <tr><th class="text-muted" style="font-weight:500;">ลูกค้า</th><td>${escHtml(current.buyer_name || current.buyer_label || '—')}${current.buyer_email ? `<div class="small text-muted">${escHtml(current.buyer_email)}</div>` : ''}</td></tr>
              <tr><th class="text-muted" style="font-weight:500;">ยอดที่ต้องโอน</th><td><b>฿${thb(current.total)}</b></td></tr>
              <tr><th class="text-muted" style="font-weight:500;">เวลาส่งสลิป</th><td>${current.slip_uploaded_at ? fmtDateTime(current.slip_uploaded_at) : '—'}</td></tr>
            </tbody>
          </table>

          <h5 class="mt-3">รายการ</h5>
          ${items.map((it) => {
            const p = (state.products || []).find((pp) => pp.id === it.product_id);
            const name = p?.name || it.product_id || '(สินค้าถูกลบ)';
            return `
            <div class="d-flex justify-content-between py-1 small">
              <span>${escHtml(name)}${it.size && it.size !== 'F' ? ` <span class="text-muted">ไซส์ ${escHtml(it.size)}</span>` : ''} <span class="text-muted">× ${it.qty}</span></span>
              <span>฿${thb((Number(it.unit_price) || 0) * (Number(it.qty) || 0))}</span>
            </div>`;
          }).join('')}

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-success flex-grow-1" id="shopVerifyApprove">
              <i class="bi bi-check2-circle me-1"></i> อนุมัติ
            </button>
            <button class="btn btn-outline-warning" id="shopVerifyReject">
              <i class="bi bi-exclamation-triangle me-1"></i> สลิปไม่ถูกต้อง
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('shopVerifyPrev')?.addEventListener('click', () => { state.verifyIdx = Math.max(0, idx - 1); renderVerifyQueue(); });
  document.getElementById('shopVerifyNext')?.addEventListener('click', () => { state.verifyIdx = Math.min(queue.length - 1, idx + 1); renderVerifyQueue(); });
  document.getElementById('shopVerifyApprove')?.addEventListener('click', async () => {
    try {
      await updateOrderStatus(current.id, 'paid', { label: STAGES_META.paid.label });
      showShopToast('อนุมัติสลิป — ย้ายไป "ชำระแล้ว"', 'success');
      await refreshOrders();
      renderVerifyQueue();
    } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
  });
  document.getElementById('shopVerifyReject')?.addEventListener('click', async () => {
    try {
      await updateOrderStatus(current.id, 'slip_mismatch', { label: STAGES_META.slip_mismatch.label });
      showShopToast('แจ้งสลิปไม่ถูกต้อง — ลูกค้าจะอัปโหลดสลิปใหม่ได้', 'warn');
      await refreshOrders();
      renderVerifyQueue();
    } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Preorder demand — per-product / per-subtype counts of preorder items,
// each expandable to the orders that contain it. Pure client-side
// aggregation over the already-loaded orders (is_preorder is the frozen
// per-item snapshot from place_shop_order).
// ---------------------------------------------------------------------
async function refreshPreorder() {
  try {
    const [orders, products] = await Promise.all([
      listAllOrders(),
      (state.products && state.products.length)
        ? Promise.resolve(state.products)
        : listProducts({ activeOnly: false }).catch(() => []),
    ]);
    state.orders = orders;
    if (products && products.length) state.products = products;
    renderPreorder();
  } catch (e) {
    showShopToast(`โหลดพรีออเดอร์ล้มเหลว: ${e.message || e}`, 'error');
  }
}

/** Aggregate active preorder demand. Cancelled orders are
 *  excluded (they no longer represent demand). Returns products sorted
 *  by total qty desc, each with a per-subtype breakdown + order id set. */
function preorderAggregate() {
  const productMap = new Map((state.products || []).map((p) => [p.id, p]));
  const dead = new Set(['cancel']);
  const byProduct = new Map();
  for (const o of state.orders || []) {
    if (dead.has(o.status)) continue;
    for (const it of (Array.isArray(o.items) ? o.items : []).filter(Boolean)) {
      if (!it.is_preorder) continue;
      const p = productMap.get(it.product_id);
      let entry = byProduct.get(it.product_id);
      if (!entry) {
        entry = {
          productId: it.product_id,
          name: p?.name || it.product_id,
          type: p?.type || 'other',
          source: p?.source || '',
          total: 0, variants: new Map(), orders: new Set(),
        };
        byProduct.set(it.product_id, entry);
      }
      const qty = Number(it.qty) || 0;
      entry.total += qty;
      entry.orders.add(o.id);
      const key = `${it.size || 'F'}|${it.color || 'default'}`;
      let v = entry.variants.get(key);
      if (!v) {
        v = { label: itemVariantLabel(p, it) || 'มาตรฐาน', qty: 0, orders: new Set() };
        entry.variants.set(key, v);
      }
      v.qty += qty;
      v.orders.add(o.id);
    }
  }
  // Organize by product type (catalogue order), then by demand desc, then
  // name — so the page groups เสื้อยืด / กางเกง / เครื่องเขียน together
  // instead of an unstructured demand ranking.
  const typeRank = (t) => {
    const i = getShopTypes().findIndex((x) => x.id === (t || 'other'));
    return i < 0 ? 99 : i;
  };
  return [...byProduct.values()].sort((a, b) =>
    typeRank(a.type) - typeRank(b.type)
    || (b.total - a.total)
    || (a.name || '').localeCompare(b.name || '', 'th'));
}

/** Apply the search + type filter to the aggregate. */
function filterPreorderAgg(agg) {
  const q = (state.preorderSearch || '').trim().toLowerCase();
  const type = state.preorderType || 'all';
  return agg.filter((e) => {
    if (type !== 'all' && e.type !== type) return false;
    if (!q) return true;
    if ((e.name || '').toLowerCase().includes(q)) return true;
    return [...e.variants.values()].some((v) => (v.label || '').toLowerCase().includes(q));
  });
}

/** Top summary cards: total pieces, products, orders, variants. */
function renderPreorderStats(agg) {
  const host = document.getElementById('shopAdminPreorderStats');
  if (!host) return;
  const pieces = agg.reduce((s, e) => s + e.total, 0);
  const orderIds = new Set();
  let variantCount = 0;
  agg.forEach((e) => { e.orders.forEach((o) => orderIds.add(o)); variantCount += e.variants.size; });
  const card = (label, value, suffix, cls = '') => `
    <div class="stat-card ${cls}">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}${suffix ? `<span class="stat-suffix">${suffix}</span>` : ''}</div>
    </div>`;
  host.innerHTML = [
    card('พรีออเดอร์รวม', pieces, 'ชิ้น', 'is-warning'),
    card('สินค้า', agg.length, 'รายการ'),
    card('คำสั่งซื้อ', orderIds.size, 'ออเดอร์'),
    card('ไซส์/สี', variantCount, 'แบบ'),
  ].join('');
}

/** Type filter chips — only types that actually have preorder demand. */
function renderPreorderTypeChips(fullAgg) {
  const host = document.getElementById('shopAdminPreorderTypes');
  if (!host) return;
  const present = new Set(fullAgg.map((e) => e.type));
  const chips = [{ id: 'all', label: 'ทุกประเภท', icon: 'bi-grid' }]
    .concat(getShopTypes().filter((t) => t.id !== 'all' && present.has(t.id)));
  if (present.has('other')) chips.push({ id: 'other', label: 'อื่น ๆ', icon: 'bi-tag' });
  host.innerHTML = chips.map((t) => `
    <button type="button" class="chip chip-sm ${state.preorderType === t.id ? 'is-active' : ''}"
            data-preorder-type="${escHtml(t.id)}">
      <i class="bi ${escHtml(t.icon || 'bi-tag')} me-1"></i>${escHtml(t.label)}
    </button>`).join('');
}

function renderPreorder() {
  const host = document.getElementById('shopAdminPreorderHost');
  if (!host) return;
  const fullAgg = preorderAggregate();
  renderPreorderStats(fullAgg);
  renderPreorderTypeChips(fullAgg);

  if (!fullAgg.length) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-hourglass"></i>
        <h4>ยังไม่มีพรีออเดอร์</h4>
        <p>คำสั่งซื้อที่สั่งช่วงพรีออเดอร์จะแสดงที่นี่</p>
      </div>`;
    return;
  }
  const agg = filterPreorderAgg(fullAgg);
  if (!agg.length) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-search"></i>
        <h4>ไม่พบพรีออเดอร์ที่ตรงกับตัวกรอง</h4>
        <p>ลองล้างคำค้นหรือเลือกประเภทอื่น</p>
      </div>`;
    return;
  }

  host.innerHTML = state.preorderView === 'cards'
    ? agg.map(preorderCardHtml).join('')
    : preorderTableHtml(agg);

  host.querySelectorAll('[data-preorder-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preorderToggle;
      if (state.preorderExpanded.has(id)) state.preorderExpanded.delete(id);
      else state.preorderExpanded.add(id);
      renderPreorder();
    });
  });
  host.querySelectorAll('[data-preorder-order]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); openOrderModal(a.dataset.preorderOrder); });
  });
}

/** Flat table view: one row per product-variant, grouped under a product
 *  header row, with a grand-total footer. Scannable for production planning. */
function preorderTableHtml(agg) {
  const typeLabel = (t) => getShopTypes().find((x) => x.id === t)?.label || (t === 'other' ? 'อื่น ๆ' : t);
  const typeIcon = (t) => getShopTypes().find((x) => x.id === t)?.icon || 'bi-tag';
  const grand = agg.reduce((s, e) => s + e.total, 0);
  // Per-type subtotal for the section header (pieces).
  const typeTotals = new Map();
  for (const e of agg) typeTotals.set(e.type, (typeTotals.get(e.type) || 0) + e.total);
  let lastType = null;
  const body = agg.map((e) => {
    const variants = [...e.variants.values()].sort((a, b) => b.qty - a.qty);
    // Emit a section header row when the product type changes.
    const section = e.type !== lastType ? (() => {
      lastType = e.type;
      return `
      <tr class="preorder-row-section">
        <td colspan="2"><i class="bi ${escHtml(typeIcon(e.type))} me-1"></i><span style="font-weight:700;">${escHtml(typeLabel(e.type))}</span></td>
        <td class="text-end" style="font-weight:700;">${typeTotals.get(e.type) || 0}</td>
        <td></td>
      </tr>`;
    })() : '';
    const head = `
      <tr class="preorder-row-product">
        <td colspan="2" class="ps-3">
          <span style="font-weight:700;">${escHtml(e.name)}</span>
        </td>
        <td class="text-end" style="font-weight:800; color:var(--shop-700);">${e.total}</td>
        <td class="text-end">${e.orders.size}</td>
      </tr>`;
    const rows = variants.map((v) => `
      <tr class="preorder-row-variant">
        <td></td>
        <td class="text-muted small">${escHtml(v.label)}</td>
        <td class="text-end">${v.qty}</td>
        <td class="text-end">
          <button type="button" class="btn btn-link btn-sm p-0" data-preorder-toggle="${escHtml(e.productId)}">${v.orders.size}</button>
        </td>
      </tr>`).join('');
    const expanded = state.preorderExpanded.has(e.productId);
    const orderRow = expanded ? `
      <tr class="preorder-row-orders"><td></td><td colspan="3">
        <div class="d-flex flex-wrap gap-2 py-1">
          ${[...e.orders].map((oid) => `
            <a href="#" class="badge bg-light text-dark border" data-preorder-order="${escHtml(oid)}"
               style="cursor:pointer; font-weight:600;">${escHtml(oid)}</a>`).join('')}
        </div></td></tr>` : '';
    return section + head + rows + orderRow;
  }).join('');
  return `
    <div class="table-responsive">
      <table class="table table-sm align-middle preorder-table mb-0">
        <thead>
          <tr>
            <th style="width:1%;"></th>
            <th>สินค้า / ไซส์-สี</th>
            <th class="text-end">จำนวน</th>
            <th class="text-end">คำสั่งซื้อ</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--shop-ink-200,#dee2e6);">
            <td colspan="2" style="font-weight:700;">รวมทั้งหมด</td>
            <td class="text-end" style="font-weight:800; color:var(--shop-700);">${grand}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function preorderCardHtml(entry) {
  const expanded = state.preorderExpanded.has(entry.productId);
  const variants = [...entry.variants.values()].sort((a, b) => b.qty - a.qty);
  return `
    <div class="preorder-card">
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <div style="font-weight:700;">${escHtml(entry.name)}</div>
          <div class="small text-muted">${entry.orders.size} คำสั่งซื้อ</div>
        </div>
        <div class="text-end">
          <div style="font-size:1.4rem; font-weight:800; color:var(--shop-700);">${entry.total}</div>
          <div class="small text-muted">ชิ้น</div>
        </div>
      </div>
      <div class="table-responsive mt-2">
        <table class="table table-sm mb-0">
          <thead><tr><th>ไซส์/สี</th><th class="text-end">จำนวน</th><th class="text-end">คำสั่งซื้อ</th></tr></thead>
          <tbody>
            ${variants.map((v) => `
              <tr>
                <td>${escHtml(v.label)}</td>
                <td class="text-end">${v.qty}</td>
                <td class="text-end">${v.orders.size}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <button type="button" class="btn btn-link btn-sm p-0 mt-2" data-preorder-toggle="${escHtml(entry.productId)}">
        ${expanded ? 'ซ่อนคำสั่งซื้อ' : 'ดูคำสั่งซื้อทั้งหมด'}
        <i class="bi bi-chevron-${expanded ? 'up' : 'down'}"></i>
      </button>
      ${expanded ? `
        <div class="mt-2 d-flex flex-wrap gap-2">
          ${[...entry.orders].map((oid) => `
            <a href="#" class="badge bg-light text-dark border" data-preorder-order="${escHtml(oid)}"
               style="cursor:pointer; font-weight:600;">${escHtml(oid)}</a>`).join('')}
        </div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------
// Batches — multi-date with per-date hours; edit anytime
// ---------------------------------------------------------------------
function blankBatch() {
  return {
    id: null,
    title: '',
    location: '',
    dates_full: [{ date: '', hours: '' }],
    product_ids: [],
    note: '',
    is_active: true,
  };
}

async function refreshBatches() {
  try {
    const [batches, products] = await Promise.all([listAllBatches(), listProducts({ activeOnly: false })]);
    state.batches = batches;
    state.products = products;
    renderBatches();
  } catch (e) {
    showShopToast(`โหลดประกาศล้มเหลว: ${e.message || e}`, 'error');
  }
}

function renderBatches() {
  const creator = document.getElementById('shopAdminBatchesCreator');
  const list = document.getElementById('shopAdminBatchesList');
  if (!creator || !list) return;

  creator.innerHTML = state.batchEditor ? batchEditorHtml(state.batchEditor) : '';
  if (state.batchEditor) wireBatchEditor();

  const active = state.batches.filter((b) => b.is_active);
  const closed = state.batches.filter((b) => !b.is_active);
  list.innerHTML = `
    <h6 class="text-muted text-uppercase small mt-3">ประกาศที่ใช้งานอยู่</h6>
    ${active.length === 0 ? '<div class="text-muted small">— ไม่มี —</div>' : active.map((b) => batchCardHtml(b, true)).join('')}
    ${closed.length ? `
      <h6 class="text-muted text-uppercase small mt-4">ประกาศก่อนหน้า</h6>
      ${closed.map((b) => batchCardHtml(b, false)).join('')}` : ''}`;

  list.querySelectorAll('[data-batch-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.batchEdit);
      const b = state.batches.find((x) => x.id === id);
      if (!b) return;
      state.batchEditor = {
        ...b,
        dates_full: batchDateEntries(b).length ? batchDateEntries(b) : [{ date: '', hours: '' }],
      };
      renderBatches();
    });
  });
  list.querySelectorAll('[data-batch-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await closeBatch(Number(btn.dataset.batchClose));
        showShopToast('ปิดประกาศแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`ปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
  list.querySelectorAll('[data-batch-reopen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await upsertBatch({ id: Number(btn.dataset.batchReopen), is_active: true });
        showShopToast('เปิดประกาศอีกครั้งแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`เปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
}

function batchCardHtml(b, isActive) {
  const entries = batchDateEntries(b);
  return `
    <div class="batch-card" ${isActive ? '' : 'style="opacity:.75;"'}>
      <div>
        <div class="b-name">${escHtml(b.title)} ${isActive ? '' : '<span class="badge bg-secondary-subtle text-secondary border ms-1">ปิดแล้ว</span>'}</div>
        <div class="b-meta mt-1">
          ${b.location ? `<i class="bi bi-geo-alt me-1"></i> ${escHtml(b.location)}` : ''}
        </div>
        ${entries.length ? `
          <div class="b-meta mt-1">
            ${entries.map((e) => `
              <span class="b-date-chip">
                <i class="bi bi-calendar3"></i> ${escHtml(e.date)}${e.hours ? ` <span class="opacity-75">· ${escHtml(e.hours)}</span>` : ''}
              </span>`).join('')}
          </div>` : ''}
        ${(b.product_ids || []).length ? `
          <div class="b-meta mt-1">
            <i class="bi bi-tag me-1"></i> ${(b.product_ids || []).map((pid) => escHtml(productName(pid))).join(', ')}
          </div>` : ''}
        ${b.note ? `<div class="b-meta mt-1"><i class="bi bi-info-circle me-1"></i>${escHtml(b.note)}</div>` : ''}
      </div>
      <div class="d-flex flex-column gap-2">
        <button class="btn btn-ghost btn-sm" data-batch-edit="${b.id}">
          <i class="bi bi-pencil me-1"></i> แก้ไข
        </button>
        ${isActive
          ? `<button class="btn btn-outline-danger btn-sm" data-batch-close="${b.id}"><i class="bi bi-archive me-1"></i> ปิดประกาศ</button>`
          : `<button class="btn btn-outline-success btn-sm" data-batch-reopen="${b.id}"><i class="bi bi-arrow-counterclockwise me-1"></i> เปิดอีกครั้ง</button>`}
      </div>
    </div>`;
}

function productName(id) {
  return state.products.find((p) => p.id === id)?.name || id;
}

function batchEditorHtml(b) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-megaphone me-1"></i> ${b.id ? 'แก้ไข' : 'สร้าง'}ประกาศการรับสินค้า</h5>
      <div class="row g-3">
        <div class="col-md-6">
          <label class="small text-muted mb-1">สินค้าที่ผลิตเสร็จ (เลือกได้มากกว่าหนึ่ง)</label>
          <select id="shopBatchProducts" class="form-select" multiple size="5">
            ${state.products.map((p) => `<option value="${escHtml(p.id)}" ${(b.product_ids || []).includes(p.id) ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">หัวเรื่องประกาศ</label>
          <input id="shopBatchTitle" class="form-control" value="${escHtml(b.title)}"
            placeholder="เช่น เสื้อ RT69 รอบที่ 1 ผลิตเสร็จแล้ว!" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">จุดรับ</label>
          <input id="shopBatchLocation" class="form-control" value="${escHtml(b.location || '')}" placeholder="เช่น ห้องสโมสรนักศึกษาฯ ชั้น 1" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูปบนการ์ดประกาศ (ไม่บังคับ)</label>
          <div class="d-flex gap-3 align-items-center flex-wrap">
            ${batchImagePreview(b)}
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-image me-1"></i> ${b.image_url || b._imageFile ? 'เปลี่ยนรูป' : 'เลือกรูป'}
              <input id="shopBatchImageFile" type="file" accept="image/*" hidden />
            </label>
            ${b.image_url || b._imageFile ? `<button type="button" class="btn btn-ghost btn-sm text-danger" id="shopBatchImageRemove">
              <i class="bi bi-x-lg me-1"></i> เอารูปออก</button>` : ''}
          </div>
          <div class="form-text">ไม่ใส่ก็ได้ — ระบบจะใช้รูปของสินค้าที่เลือกไว้ด้านบน${b._imageFile ? ' · รูปใหม่จะอัปโหลดตอนกดบันทึก' : ''}</div>
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <div class="form-check">
            <input id="shopBatchActive" class="form-check-input" type="checkbox" ${b.is_active ? 'checked' : ''} />
            <label for="shopBatchActive" class="form-check-label">เปิดแสดงในหน้าร้าน</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">วันที่และเวลารับ (เพิ่มได้หลายวัน แต่ละวันมีเวลาแยก)</label>
          <div id="shopBatchDateRows" class="d-flex flex-column gap-2">
            ${b.dates_full.map((e, i) => batchDateRowHtml(e, i)).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm mt-2" id="shopBatchAddDate">
            <i class="bi bi-plus-lg"></i> เพิ่มวัน
          </button>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <textarea id="shopBatchNote" class="form-control" rows="2" placeholder="เช่น กรุณานำบัตรนักศึกษามาด้วย">${escHtml(b.note || '')}</textarea>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopBatchCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopBatchSave">
          <i class="bi bi-megaphone me-1"></i> ${b.id ? 'บันทึก' : 'ประกาศ'}
        </button>
      </div>
    </div>`;
}

function batchDateRowHtml(entry, idx) {
  return `
    <div class="batch-date-row d-flex gap-2 align-items-center" data-batch-row="${idx}">
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-calendar3"></i></span>
        <input type="text" class="form-control" data-batch-date-idx="${idx}" value="${escHtml(entry.date)}" placeholder="เช่น 27 พ.ค." />
      </div>
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-clock"></i></span>
        <input type="text" class="form-control" data-batch-hours-idx="${idx}" value="${escHtml(entry.hours)}" placeholder="เช่น 10:00–17:00 น." />
      </div>
      <button type="button" class="btn btn-ghost btn-sm text-danger" data-batch-remove-row="${idx}" title="ลบวันนี้">
        <i class="bi bi-trash3"></i>
      </button>
    </div>`;
}

/** Preview for the announcement picture: the file picked but not yet saved
 *  (a local blob URL), else the saved one, else what the storefront will fall
 *  back to — the first chosen product that has a picture — so the admin sees
 *  what customers will see. */
function batchImagePreview(b) {
  const style = 'width:96px; height:72px; object-fit:cover; border-radius:8px; border:1px solid var(--shop-ink-100, #ebecee);';
  // A blob: URL this page minted itself (createObjectURL) — safeUrl() allows
  // only http(s)/mailto/tel and would turn it into '#', so it is escaped, not
  // filtered.
  if (b._imagePreview && b._imagePreview.startsWith('blob:')) return `<img src="${escHtml(b._imagePreview)}" alt="" style="${style}" />`;
  if (b.image_url) return `<img src="${safeUrl(convertDriveUrl(b.image_url))}" alt="" style="${style}" />`;
  const p = (state.products || []).find((x) => (b.product_ids || []).includes(x.id) && x.image_url);
  if (p) return `<img src="${safeUrl(convertDriveUrl(p.image_url))}" alt="" style="${style} opacity:.6;" title="ใช้รูปสินค้าแทน" />`;
  return '';
}

function wireBatchEditor() {
  const b = state.batchEditor;
  // PICKED, not uploaded: the upload happens in the save handler, so a picture
  // chosen and then abandoned never becomes an orphan in Drive
  // (upload-on-save — the cleanup cannot reach a file nothing references).
  document.getElementById('shopBatchImageFile')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 8 MB', 'warn'); return; }
    collectBatchEditorState();
    if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
    b._imageFile = f;
    b._imagePreview = URL.createObjectURL(f);
    renderBatches();
  });
  document.getElementById('shopBatchImageRemove')?.addEventListener('click', () => {
    collectBatchEditorState();
    if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
    b._imageFile = null; b._imagePreview = null; b.image_url = '';
    renderBatches();
  });
  document.getElementById('shopBatchCancel')?.addEventListener('click', () => { state.batchEditor = null; renderBatches(); });
  document.getElementById('shopBatchAddDate')?.addEventListener('click', () => {
    collectBatchEditorState();
    b.dates_full.push({ date: '', hours: '' });
    renderBatches();
  });
  document.querySelectorAll('[data-batch-remove-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectBatchEditorState();
      const i = Number(btn.dataset.batchRemoveRow);
      b.dates_full.splice(i, 1);
      if (b.dates_full.length === 0) b.dates_full.push({ date: '', hours: '' });
      renderBatches();
    });
  });
  document.getElementById('shopBatchSave')?.addEventListener('click', async () => {
    collectBatchEditorState();
    if (!b.title) { showShopToast('กรุณากรอกหัวเรื่อง', 'warn'); return; }
    const cleanDates = b.dates_full.filter((e) => e.date.trim());
    if (cleanDates.length === 0) { showShopToast('กรุณาระบุวันรับอย่างน้อย 1 วัน', 'warn'); return; }
    const payload = {
      id: b.id,
      title: b.title,
      location: b.location,
      dates_full: cleanDates,
      // Legacy mirror for older readers — single dates[] without hours per item.
      dates: cleanDates.map((e) => e.date),
      hours: cleanDates[0]?.hours || '',
      product_ids: b.product_ids,
      note: b.note,
      is_active: b.is_active,
      image_url: b.image_url || null,
    };
    // The picture this row is about to stop pointing at, for the cleanup below.
    const prev = String(state.batches.find((x) => x.id === b.id)?.image_url || '').trim();
    const btn = document.getElementById('shopBatchSave');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…'; }
    try {
      if (b._imageFile) {
        const ext = (b._imageFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
        payload.image_url = await uploadShopFile(b._imageFile, 'Shop/Batches',
          { fileName: `batch_${Date.now()}.${ext}`, maxEdge: 2000 });
      }
      await upsertBatch(payload);
      // Trash the replaced picture AFTER the write, and only if nothing else
      // still shows it — another announcement, or a product.
      if (prev && prev !== (payload.image_url || '')
          && !state.batches.some((x) => x.id !== b.id && x.image_url === prev)
          && !(state.products || []).some((p) => p.image_url === prev)) {
        deleteShopFile(prev).catch(() => {});
      }
      if (b._imagePreview) URL.revokeObjectURL(b._imagePreview);
      showShopToast('บันทึกประกาศแล้ว', 'success');
      state.batchEditor = null;
      refreshBatches();
    } catch (e) {
      showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-megaphone me-1"></i> ${b.id ? 'บันทึก' : 'ประกาศ'}`; }
    }
  });
}

function collectBatchEditorState() {
  const b = state.batchEditor;
  if (!b) return;
  b.title = document.getElementById('shopBatchTitle')?.value.trim() || '';
  b.location = document.getElementById('shopBatchLocation')?.value.trim() || '';
  b.note = document.getElementById('shopBatchNote')?.value.trim() || '';
  b.is_active = !!document.getElementById('shopBatchActive')?.checked;
  const ms = document.getElementById('shopBatchProducts');
  b.product_ids = ms ? Array.from(ms.selectedOptions).map((o) => o.value) : [];
  const newDates = [];
  b.dates_full.forEach((_, i) => {
    const d = document.querySelector(`[data-batch-date-idx="${i}"]`)?.value || '';
    const h = document.querySelector(`[data-batch-hours-idx="${i}"]`)?.value || '';
    newDates.push({ date: d.trim(), hours: h.trim() });
  });
  b.dates_full = newDates.length ? newDates : [{ date: '', hours: '' }];
}

// ---------------------------------------------------------------------
// Products — drop fit, add stock_status, add stock matrix editor
// ---------------------------------------------------------------------
function blankProduct() {
  // Default type = first real (non-'all') entry of the managed list, so a
  // new product picks a type that actually exists.
  const firstType = getShopTypes().find((t) => t.id !== 'all')?.id || 'apparel-shirt';
  return {
    id: '',
    name: '',
    sub: '',
    description: '',
    type: firstType,
    source: 'md',
    price: 0,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ id: 'black', label: 'ดำ', hex: '#1a1a1a' }],
    fits: ['unisex'],
    hue: 220,
    image_url: '',
    is_new: true,
    is_presale: false,
    presale_note: '',
    popularity: 0,
    is_active: true,
    stock_status: 'available',
    stock_matrix: {},
    price_by_size: {},
    preorder_price_by_size: {},
    promptpay_qr_id: null,
    pickup_location_id: null,
    _imageFile: null,
  };
}

async function refreshProducts() {
  try {
    state.products = await listProducts({ activeOnly: false });
    renderProductsTable();
    renderProductEditor();
  } catch (e) { showShopToast(`โหลดสินค้าล้มเหลว: ${e.message || e}`, 'error'); }
}

function renderProductsTable() {
  const tbody = document.getElementById('shopAdminProductsTbody');
  if (!tbody) return;
  if (state.products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">ยังไม่มีสินค้า</td></tr>`;
    return;
  }
  tbody.innerHTML = state.products.map((p) => {
    const stockSum = totalStock(p.stock_matrix);
    return `
    <tr>
      <td>
        <div class="d-flex gap-2 align-items-center">
          <div style="width:28px; height:36px; border-radius:4px; flex:0 0 auto; ${miniStyle(p)}"></div>
          <div>
            <div style="font-weight:600;">${escHtml(p.name)}</div>
            <div class="small text-muted">${escHtml(p.sub || '')}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(findSource(p.source)?.label || p.source)}
        </span>
      </td>
      <td class="text-nowrap">
        <b>${(() => { const r = priceRange(p); return r.min === r.max ? `฿${thb(r.min)}` : `฿${thb(r.min)}–${thb(r.max)}`; })()}</b>
        ${(p.is_presale && p.preorder_price != null && Number(p.preorder_price) !== Number(p.price))
          ? `<span class="text-muted small text-decoration-line-through ms-1">฿${thb(p.price)}</span>`
          : ''}
      </td>
      <td>
        <span class="small text-muted">${(p.sizes || []).length} × ${(p.colors || []).length}</span>
        ${stockSum !== null ? `<div class="small">รวม ${stockSum} ชิ้น</div>` : '<div class="small text-muted">ไม่ระบุ</div>'}
      </td>
      <td>
        ${p.is_active
          ? `<span class="badge bg-success-subtle text-success border border-success-subtle">เปิดขาย</span>`
          : `<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>`}
        ${p.is_presale ? `<span class="badge bg-warning-subtle text-warning border ms-1">Preorder</span>` : ''}
        ${p.stock_status && p.stock_status !== 'available'
          ? `<span class="badge ${STOCK_STATUS_META[p.stock_status]?.badgeCls || ''} ms-1">${escHtml(STOCK_STATUS_META[p.stock_status]?.label || p.stock_status)}</span>`
          : ''}
      </td>
      <td>
        <button class="btn btn-sm btn-ghost" data-product-edit="${escHtml(p.id)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-ghost text-danger" data-product-delete="${escHtml(p.id)}"><i class="bi bi-trash3"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-product-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.products.find((x) => x.id === btn.dataset.productEdit);
      if (p) { state.productEditor = { ...p, _imageFile: null, stock_matrix: { ...(p.stock_matrix || {}) } }; renderProductEditor(); }
    });
  });
  tbody.querySelectorAll('[data-product-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.productDelete;
      if (!confirm(`ลบสินค้า ${pid}?`)) return;
      try {
        await deleteProduct(pid);
        showShopToast('ลบสินค้าแล้ว', 'success');
        refreshProducts();
      } catch (e) {
        // Product has order history → can't hard-delete. Offer to archive
        // (hide from shop) instead, which keeps the order records intact.
        if (e.code === 'PRODUCT_HAS_ORDERS') {
          if (confirm('สินค้านี้มีประวัติการสั่งซื้อ จึงลบถาวรไม่ได้ (เพื่อรักษาบันทึกคำสั่งซื้อเดิม)\n\nต้องการ "ปิดการขาย" แทนไหม? สินค้าจะถูกซ่อนจากหน้าร้าน แต่ยังเห็นและเปิดขายใหม่ได้ในแอดมิน')) {
            try {
              await archiveProduct(pid);
              showShopToast('ปิดการขายแล้ว (ซ่อนจากหน้าร้าน)', 'success');
              refreshProducts();
            } catch (e2) { showShopToast(`ปิดการขายไม่สำเร็จ: ${e2.message || e2}`, 'error'); }
          }
          return;
        }
        showShopToast(`ลบไม่สำเร็จ: ${e.message || e}`, 'error');
      }
    });
  });
}

function renderProductEditor() {
  const host = document.getElementById('shopAdminProductEditor');
  if (!host) return;
  if (!state.productEditor) { host.innerHTML = ''; return; }
  const p = state.productEditor;
  host.innerHTML = `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-pencil-square me-1"></i> ${p.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h5>
      <div class="row g-3">
        <div class="col-md-3">
          <label class="small text-muted mb-1">รหัสสินค้า (id ภายใน)</label>
          <input id="shopProdId" class="form-control font-mono" value="${escHtml(p.id)}" ${p.id ? 'disabled' : ''} placeholder="auto-generate ถ้าว่าง" />
          ${p.id ? '<div class="form-text">id ภายในแก้ไขไม่ได้ (เป็นกุญแจที่คำสั่งซื้อเก่าอ้างถึง)</div>' : ''}
        </div>
        <div class="col-md-2">
          <label class="small text-muted mb-1">รหัสนำหน้า Order</label>
          <input id="shopProdCode" class="form-control font-mono text-uppercase" maxlength="5"
            value="${escHtml(p.code || '')}" placeholder="SH" />
          <div class="form-text">ใช้นำหน้า Order ID เช่น "SH" → SH1234</div>
        </div>
        <div class="col-md-7">
          <label class="small text-muted mb-1">ชื่อสินค้า</label>
          <input id="shopProdName" class="form-control" value="${escHtml(p.name)}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">คำบรรยายย่อ</label>
          <input id="shopProdSub" class="form-control" value="${escHtml(p.sub || '')}" />
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ราคา (บาท)</label>
          <input id="shopProdPrice" type="number" min="0" class="form-control" value="${Number(p.price) || 0}" />
          <div class="form-text">ราคาเมื่อสินค้าพร้อมส่ง</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ราคา Preorder (บาท)</label>
          <input id="shopProdPreorderPrice" type="number" min="0" class="form-control"
                 value="${p.preorder_price == null ? '' : Number(p.preorder_price)}"
                 placeholder="ใช้ราคาเดียวกัน" />
          <div class="form-text">แสดงเมื่อ Preorder ติ๊ก — ปล่อยว่างเพื่อใช้ราคาปกติ</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">โทนสีพื้นหลังเมื่อไม่มีรูป (0–360)</label>
          <div class="input-group">
            <span class="input-group-text shop-hue-swatch" id="shopProdHueSwatch"
              style="background: hsl(${Number(p.hue) || 220} 30% 90%);"></span>
            <input id="shopProdHue" type="number" min="0" max="360" class="form-control"
              value="${Number(p.hue) || 220}" />
          </div>
          <div class="form-text">เลื่อนค่าเพื่อปรับพื้นหลังลายพราง (placeholder) ของสินค้านี้</div>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">แหล่งที่มา</label>
          <select id="shopProdSource" class="form-select">
            ${SHOP_SOURCES.filter((s) => s.id !== 'all').map((s) =>
              `<option value="${s.id}" ${p.source === s.id ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">ประเภท</label>
          <select id="shopProdType" class="form-select">
            ${getShopTypes().filter((t) => t.id !== 'all').map((t) =>
              `<option value="${t.id}" ${p.type === t.id ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">สถานะสต็อก</label>
          <select id="shopProdStockStatus" class="form-select">
            ${STOCK_STATUSES.map((s) =>
              `<option value="${s}" ${p.stock_status === s ? 'selected' : ''}>${escHtml(STOCK_STATUS_META[s]?.label || s)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">บัญชี PromptPay รับเงิน</label>
          <select id="shopProdQr" class="form-select">
            <option value="" ${p.promptpay_qr_id == null ? 'selected' : ''}>ค่าเริ่มต้น (บัญชีหลัก)</option>
            ${getPromptpayQrs().map((q) =>
              `<option value="${q.id}" ${String(p.promptpay_qr_id) === String(q.id) ? 'selected' : ''}>${escHtml(q.label || q.promptpay_name || ('บัญชี #' + q.id))}${q.is_default ? ' — ค่าเริ่มต้น' : ''}${q.is_active ? '' : ' (ปิด)'}</option>`).join('')}
          </select>
          <div class="form-text">ตะกร้าที่มีสินค้าหลายบัญชีจะถูกแยกเป็นหลายคำสั่งซื้อตอน checkout</div>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">สถานที่รับสินค้า (แสดงให้ลูกค้าตอนซื้อ)</label>
          <select id="shopProdPickup" class="form-select">
            <option value="" ${p.pickup_location_id == null ? 'selected' : ''}>ไม่ระบุ</option>
            ${getPickupLocations().map((l) =>
              `<option value="${l.id}" ${String(p.pickup_location_id) === String(l.id) ? 'selected' : ''}>${escHtml(l.label || ('สถานที่ #' + l.id))}${l.is_active ? '' : ' (ปิด)'}</option>`).join('')}
          </select>
        </div>
        <div class="col-12">
          <div class="p-3 rounded" style="background: var(--shop-50, #f0f7f1); border: 1px solid var(--shop-100, #d6e9da);">
            <label class="small fw-bold mb-1">สถานะผลิตสินค้านี้ (กระทบกับคำสั่งซื้อ)</label>
            <select id="shopProdProductionStatus" class="form-select mb-2" style="max-width:280px;">
              <option value="pending"   ${p.production_status === 'pending'   || !p.production_status ? 'selected' : ''}>ยังไม่ผลิต — ไม่ขยับคำสั่งซื้อ</option>
              <option value="produced"  ${p.production_status === 'produced'  ? 'selected' : ''}>สินค้าผลิตเสร็จแล้ว — ย้าย "ยืนยันการชำระเงิน" → "ผลิตเสร็จ"</option>
              <option value="announced" ${p.production_status === 'announced' ? 'selected' : ''}>ประกาศรอบรับสินค้า — ย้ายต่อไป "ประกาศแล้ว"</option>
            </select>
            <div class="form-text mb-0">
              เลือก "สินค้าผลิตเสร็จแล้ว" จะย้ายเฉพาะคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน". เลือก "ประกาศรอบรับสินค้า" จะย้ายทั้ง "ยืนยันการชำระเงิน" และ "สินค้าผลิตเสร็จแล้ว".
              คำสั่งซื้อที่อยู่ในสถานะปัญหา (สลิปไม่ถูกต้อง · ยกเลิก) จะไม่ถูกแตะ.
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ไซส์ (คั่นด้วยจุลภาค — เช่น S,M,L,XL หรือ F สำหรับ free-size)</label>
          <input id="shopProdSizes" class="form-control" value="${escHtml((p.sizes || []).join(','))}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">สี (เพิ่มได้ตามต้องการ — ปล่อยว่างถ้าสินค้านี้ไม่มีตัวเลือกสี)</label>
          <div id="shopProdColorsList" class="d-flex flex-column gap-2">${colorPickerRowsHtml(p.colors)}</div>
          <button type="button" class="btn btn-ghost btn-sm mt-1" id="shopProdColorsAdd">
            <i class="bi bi-plus-lg me-1"></i> เพิ่มสี
          </button>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">รายละเอียด</label>
          <textarea id="shopProdDesc" class="form-control" rows="3">${escHtml(p.description || '')}</textarea>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูปสินค้า</label>
          <div class="d-flex gap-3 align-items-center">
            ${p.image_url ? `<img src="${safeUrl(convertDriveUrl(p.image_url))}" alt="" style="width:80px; height:100px; object-fit:cover; border-radius:6px; border:1px solid var(--shop-ink-100, #ebecee);" />` : ''}
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-cloud-upload me-1"></i> ${p.image_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
              <input id="shopProdImageFile" type="file" accept="image/*" hidden />
            </label>
            ${p._imageFile ? `<span class="small text-muted">${escHtml(p._imageFile.name)} (รอบันทึก)</span>` : ''}
          </div>
        </div>
        <div class="col-md-6 d-flex align-items-end gap-3 flex-wrap">
          <div class="form-check">
            <input id="shopProdIsNew" class="form-check-input" type="checkbox" ${p.is_new ? 'checked' : ''} />
            <label for="shopProdIsNew" class="form-check-label">NEW</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsPresale" class="form-check-input" type="checkbox" ${p.is_presale ? 'checked' : ''} />
            <label for="shopProdIsPresale" class="form-check-label">Preorder</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsActive" class="form-check-input" type="checkbox" ${p.is_active ? 'checked' : ''} />
            <label for="shopProdIsActive" class="form-check-label">เปิดขาย</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ Preorder</label>
          <input id="shopProdPresaleNote" class="form-control" value="${escHtml(p.presale_note || '')}" placeholder="เช่น ผลิตเสร็จ 20 มิ.ย. 2026" />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">ราคาต่อไซส์ (ไม่บังคับ)</label>
          <div id="shopProdSizePrices">${sizePricesHtml(p)}</div>
          <div class="small text-muted mt-1">
            เว้นว่าง = ใช้ราคาด้านบน · ราคา Preorder ใช้ตอนติ๊ก Preorder เท่านั้น ถ้าเว้นว่างจะใช้ราคา Preorder ด้านบน
            (ถ้าไม่ได้ตั้งไว้ จะใช้ราคาปกติของไซส์นั้น)
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">สต็อกต่อไซส์ × สี</label>
          <div id="shopProdStockMatrix">${stockMatrixHtml(p)}</div>
          <div class="small text-muted mt-1">
            ตั้งค่า "0" สำหรับตัวเลือกที่หมด — เว้นว่างไว้แปลว่ายังไม่ระบุ
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopProdCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopProdSave">
          <i class="bi bi-save me-1"></i> บันทึก
        </button>
      </div>
    </div>`;

  document.getElementById('shopProdImageFile')?.addEventListener('change', (e) => {
    p._imageFile = e.target.files?.[0] || null;
    renderProductEditor();
  });

  // Re-render the matrix when sizes change so admin can dial in stock
  // immediately after editing variants. Color rows handle their own
  // refresh below via the colors-list delegated handler.
  document.getElementById('shopProdSizes')?.addEventListener('change', refreshMatrixOnly);

  // Live hue swatch
  const hueInput = document.getElementById('shopProdHue');
  const hueSwatch = document.getElementById('shopProdHueSwatch');
  hueInput?.addEventListener('input', () => {
    const h = Math.max(0, Math.min(360, Number(hueInput.value) || 0));
    if (hueSwatch) hueSwatch.style.background = `hsl(${h} 30% 90%)`;
  });

  // Colors: add row, remove row, label/hex changes → refresh matrix.
  document.getElementById('shopProdColorsAdd')?.addEventListener('click', () => {
    const list = document.getElementById('shopProdColorsList');
    if (!list) return;
    const idx = list.children.length;
    list.insertAdjacentHTML('beforeend', colorPickerRowHtml({ id: '', label: '', hex: '#cccccc' }, idx));
    refreshMatrixOnly();
  });
  const colorsList = document.getElementById('shopProdColorsList');
  if (colorsList) {
    colorsList.addEventListener('click', (ev) => {
      const removeBtn = ev.target.closest('[data-color-remove]');
      if (!removeBtn) return;
      removeBtn.closest('.shop-color-row')?.remove();
      refreshMatrixOnly();
    });
    colorsList.addEventListener('input', refreshMatrixOnly);
  }

  document.getElementById('shopProdCancel')?.addEventListener('click', () => { state.productEditor = null; renderProductEditor(); });
  document.getElementById('shopProdSave')?.addEventListener('click', saveProductForm);
}

function refreshMatrixOnly() {
  const p = state.productEditor;
  if (!p) return;
  // Keep what was typed in the per-size price table across the re-render.
  Object.assign(p, readSizePrices());
  // pull live values, replace in-memory + re-render only the matrix area
  p.sizes  = (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Read colors from the row picker (replaces the old JSON textarea).
  // readColorRows returns [] when the list isn't rendered yet — safe.
  p.colors = readColorRows();
  const host = document.getElementById('shopProdStockMatrix');
  if (host) host.innerHTML = stockMatrixHtml(p);
  const prices = document.getElementById('shopProdSizePrices');
  if (prices) prices.innerHTML = sizePricesHtml(p);
}

/** Per-size price table (0199): one row per size, a normal and a preorder
 *  price. Blank = the product-wide price applies — exactly the fallback
 *  public.shop_unit_price() uses, so what is typed here is what is charged. */
function sizePricesHtml(p) {
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const reg = p.price_by_size || {};
  const pre = p.preorder_price_by_size || {};
  const val = (m, s) => (m[s] == null ? '' : Number(m[s]));
  return `
    <div class="stock-matrix">
      <table class="stock-matrix-table">
        <thead><tr><th>ไซส์</th><th>ราคาปกติ (บาท)</th><th>ราคา Preorder (บาท)</th></tr></thead>
        <tbody>
          ${sizes.map((s) => `
            <tr>
              <th>${escHtml(s === 'F' ? 'Free size' : s)}</th>
              <td><input type="number" min="0" step="1" class="form-control form-control-sm"
                   data-size-price="${escHtml(s)}" value="${val(reg, s)}" placeholder="ราคาด้านบน" /></td>
              <td><input type="number" min="0" step="1" class="form-control form-control-sm"
                   data-size-preorder-price="${escHtml(s)}" value="${val(pre, s)}" placeholder="ราคา Preorder ด้านบน" /></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Read the per-size table into { price_by_size, preorder_price_by_size }.
 *  Only sizes the product still HAS are kept, so removing a size from the
 *  list also removes its price. Blank / invalid → no entry (base applies). */
function readSizePrices() {
  const out = { price_by_size: {}, preorder_price_by_size: {} };
  const read = (attr, into) => document.querySelectorAll(`[${attr}]`).forEach((el) => {
    const raw = String(el.value || '').trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    into[el.getAttribute(attr)] = Math.round(n);
  });
  read('data-size-price', out.price_by_size);
  read('data-size-preorder-price', out.preorder_price_by_size);
  return out;
}

function stockMatrixHtml(p) {
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const colors = (p.colors && p.colors.length) ? p.colors : [{ id: 'default', label: 'มาตรฐาน', hex: '#ccc' }];
  const matrix = p.stock_matrix || {};
  return `
    <div class="stock-matrix">
      <table class="stock-matrix-table">
        <thead>
          <tr>
            <th></th>
            ${sizes.map((s) => `<th>${escHtml(s)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${colors.map((c) => `
            <tr>
              <th>
                <span class="stock-color-swatch" style="background:${escHtml(c.hex || '#ccc')};"></span>
                ${escHtml(c.label || c.id)}
              </th>
              ${sizes.map((s) => {
                const k = stockKey(s, c.id);
                const v = matrix[k];
                return `<td>
                  <input type="number" min="0" class="form-control form-control-sm"
                    data-stock-key="${escHtml(k)}"
                    value="${v === undefined || v === null ? '' : Number(v)}"
                    placeholder="-" />
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function readStockMatrix() {
  const matrix = {};
  document.querySelectorAll('[data-stock-key]').forEach((el) => {
    const k = el.dataset.stockKey;
    const raw = el.value.trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    matrix[k] = Math.floor(n);
  });
  return matrix;
}

async function saveProductForm() {
  const e = state.productEditor;
  if (!e) return;
  const name = document.getElementById('shopProdName')?.value.trim() || '';
  if (!name) { showShopToast('กรุณากรอกชื่อสินค้า', 'warn'); return; }

  // Read color rows out of the picker UI. Each row contributes
  // { id, label, hex } — id falls back to a slug of the label so admin
  // doesn't have to think about it.
  const colors = readColorRows();

  const payload = {
    id: e.id || `p-${slugify(name)}-${Math.floor(Math.random() * 999)}`,
    code: sanitizeOrderCode(document.getElementById('shopProdCode')?.value || ''),
    name,
    sub: document.getElementById('shopProdSub')?.value.trim() || null,
    description: document.getElementById('shopProdDesc')?.value || null,
    source: document.getElementById('shopProdSource')?.value || 'md',
    type: document.getElementById('shopProdType')?.value || 'apparel-shirt',
    price: Math.max(0, Number(document.getElementById('shopProdPrice')?.value) || 0),
    preorder_price: (() => {
      const raw = document.getElementById('shopProdPreorderPrice')?.value;
      if (raw == null || String(raw).trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    })(),
    hue: Math.max(0, Math.min(360, Number(document.getElementById('shopProdHue')?.value) || 220)),
    sizes: (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    fits: ['unisex'],
    colors,
    is_new: !!document.getElementById('shopProdIsNew')?.checked,
    is_presale: !!document.getElementById('shopProdIsPresale')?.checked,
    is_active: !!document.getElementById('shopProdIsActive')?.checked,
    stock_status: document.getElementById('shopProdStockStatus')?.value || 'available',
    stock_matrix: readStockMatrix(),
    ...(() => {
      // Drop entries for sizes no longer on the product.
      const sizes = (document.getElementById('shopProdSizes')?.value || '').split(',').map((x) => x.trim()).filter(Boolean);
      const keep = new Set(sizes.length ? sizes : ['F']);
      const { price_by_size, preorder_price_by_size } = readSizePrices();
      const only = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => keep.has(k)));
      return { price_by_size: only(price_by_size), preorder_price_by_size: only(preorder_price_by_size) };
    })(),
    presale_note: document.getElementById('shopProdPresaleNote')?.value.trim() || null,
    // Catalog config (migration 0057). Empty select value → null (default
    // account / no pickup line).
    promptpay_qr_id: (() => { const v = document.getElementById('shopProdQr')?.value; return v ? Number(v) : null; })(),
    pickup_location_id: (() => { const v = document.getElementById('shopProdPickup')?.value; return v ? Number(v) : null; })(),
    image_url: e.image_url || null,
  };

  const btn = document.getElementById('shopProdSave');
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…'; }

  // The image the row is about to stop pointing at. Captured before the upload
  // overwrites payload.image_url.
  const prevImage = String(e.image_url || '').trim();
  try {
    if (e._imageFile) {
      const ext = (e._imageFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
      const fileName = `${slugify(name)}_${Date.now()}.${ext}`;
      payload.image_url = await uploadShopFile(e._imageFile, `Shop/Products/${payload.id}`, { fileName });
    }
    await upsertProduct(payload);
    // Trash the replaced image, AFTER the write — the row now points elsewhere,
    // so this cannot destroy a picture the catalogue is still using. Skipped
    // when any OTHER product shares the URL: a shop admin can read every
    // product row, so this list is complete for this caller (unlike the
    // RLS-blocked client-side count that made the ทีม SAMO refcount fail open).
    if (prevImage && prevImage !== (payload.image_url || '')
        && !(state.products || []).some((p) => p.id !== payload.id && p.image_url === prevImage)) {
      deleteShopFile(prevImage).catch(() => {});
    }

    // Production status cascade — only when the dropdown changed from
    // the original. The RPC owns the field + the order cascade so this
    // path doesn't have to coordinate two writes.
    const newProdStatus = document.getElementById('shopProdProductionStatus')?.value || 'pending';
    const oldProdStatus = e.production_status || 'pending';
    if (newProdStatus !== oldProdStatus) {
      const ok = await maybeConfirmCascade(newProdStatus);
      if (ok) {
        try {
          const r = await applyProductProductionStatus(payload.id, newProdStatus);
          const moved = (r.moved_to_produce || 0) + (r.moved_to_ready || 0);
          if (moved > 0) {
            showShopToast(`อัปเดต ${moved} คำสั่งซื้อตามสถานะผลิตใหม่`, 'success');
          }
        } catch (err) {
          showShopToast(`สถานะผลิตอัปเดตไม่สำเร็จ: ${err.message || err}`, 'warn');
        }
      }
    }

    showShopToast('บันทึกสินค้าแล้ว', 'success');
    state.productEditor = null;
    refreshProducts();
  } catch (err) {
    showShopToast(`บันทึกล้มเหลว: ${err.message || err}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = original || 'บันทึก'; }
  }
}

function maybeConfirmCascade(nextStatus) {
  if (nextStatus === 'pending') return true; // no cascade
  const msg = nextStatus === 'produced'
    ? 'จะย้ายคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน" ที่มีสินค้านี้ทั้งหมดไปเป็น "สินค้าผลิตเสร็จแล้ว". ยืนยัน?'
    : 'จะย้ายคำสั่งซื้อสถานะ "ยืนยันการชำระเงิน" และ "สินค้าผลิตเสร็จแล้ว" ที่มีสินค้านี้ทั้งหมดไปเป็น "ประกาศแล้ว". ยืนยัน?';
  return window.confirm(msg);
}

function miniStyle(p) {
  if (p?.image_url) return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

// ---------------------------------------------------------------------
// Stock — fast at-a-glance editor
//
// Each product is a card with image + name + total-stock pill + status,
// and an inline size×color grid where each cell has +/- buttons and a
// direct-input number. Empty = unspecified, 0 = OOS, ≤3 yellow, ≥1 green.
// "บันทึก" per card writes only stock_matrix + stock_status (not image).
// ---------------------------------------------------------------------
async function refreshStock() {
  try {
    // Pull products AND orders — the per-product sales summary in the
    // stock card uses the orders list to count "reserved" / "delivered"
    // / "outstanding" so admin can size the next production run without
    // doing the math by hand.
    const [products, orders] = await Promise.all([
      listProducts({ activeOnly: false }),
      (!state.orders || state.orders.length === 0)
        ? listAllOrders().catch(() => [])
        : Promise.resolve(state.orders),
    ]);
    state.products = products;
    if (orders && orders.length) state.orders = orders;
    // Drop any pending edits that no longer apply
    for (const id of Array.from(state.stockEdits.keys())) {
      if (!state.products.find((p) => p.id === id)) state.stockEdits.delete(id);
    }
    renderStock();
  } catch (e) {
    showShopToast(`โหลดสินค้าล้มเหลว: ${e.message || e}`, 'error');
  }
}

// Order-level statuses that consume stock — uploaded slip onward, until
// the order completes. A cancelled order frees its qty from the reserved
// bucket. (A per-item 'issue' / มีปัญหา does NOT free stock — its order
// stays 'paid', so it keeps counting here.)
const RESERVED_STATUSES = new Set(['review', 'paid', 'produce', 'ready', 'done']);

/** Aggregate the order qty for a product across the orders cache,
 *  bucketed so admin can read the per-product stock-vs-demand state
 *  at a glance:
 *    reserved    = qty in any happy-path status (RESERVED_STATUSES)
 *    delivered   = qty in 'done' specifically
 *    outstanding = reserved - delivered (paid-for, not yet picked up) */
function computeProductSales(productId) {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  let reserved = 0, delivered = 0;
  for (const o of orders) {
    if (!RESERVED_STATUSES.has(o.status)) continue;
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue;
      // Preorder is made-to-order — it doesn't reserve finite stock
      // (matches migration 0038's reserved-matrix predicate).
      if (it.is_preorder) continue;
      const q = Number(it.qty) || 0;
      reserved += q;
      if (o.status === 'done') delivered += q;
    }
  }
  return { reserved, delivered, outstanding: reserved - delivered };
}

/** Same accounting, but bucketed per variant (size + color). Returns
 *  a Map keyed by `${productId}|${size}|${color}` → qty so the stock
 *  matrix render can lookup in O(1). Items missing size default to 'F';
 *  missing color defaults to 'default' — matches stockKey(). */
function computeVariantReservedMap() {
  const orders = Array.isArray(state.orders) ? state.orders : [];
  const out = new Map();
  for (const o of orders) {
    if (!RESERVED_STATUSES.has(o.status)) continue;
    for (const it of (o.items || [])) {
      // Preorder doesn't reserve finite stock (see migration 0038).
      if (it.is_preorder) continue;
      const size  = it.size  || 'F';
      const color = it.color || 'default';
      const key = `${it.product_id}|${size}|${color}`;
      out.set(key, (out.get(key) || 0) + (Number(it.qty) || 0));
    }
  }
  return out;
}

/** Production-status dropdown handler on the stock card. Same
 *  confirmation + RPC + toast pattern the product editor uses. */
async function onStockProductionStatusChange(sel) {
  const productId = sel.dataset.stockProductionSel;
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const previous = p.production_status || 'pending';
  const next = sel.value;
  if (next === previous) return;
  const confirmed = await maybeConfirmCascade(next);
  if (!confirmed) {
    // Revert the picker — user backed out of the cascade dialog.
    sel.value = previous;
    return;
  }
  sel.disabled = true;
  try {
    const r = await applyProductProductionStatus(productId, next);
    p.production_status = next;
    const moved = (r.moved_to_produce || 0) + (r.moved_to_ready || 0);
    if (moved > 0) {
      showShopToast(`เปลี่ยนสถานะ + ย้าย ${moved} คำสั่งซื้อแล้ว`, 'success');
    } else {
      showShopToast('เปลี่ยนสถานะแล้ว', 'success');
    }
    // Refresh orders so the per-product sales summary + per-item
    // progress (item_status cascaded by the RPC) reflect the moves.
    state.orders = await listAllOrders().catch(() => state.orders);
    renderStock();
    renderOrdersTable();
    if (modalOrder) await reloadModalOrderFromServer();
  } catch (e) {
    showShopToast(`สถานะผลิตอัปเดตไม่สำเร็จ: ${e.message || e}`, 'error');
    sel.value = previous;
  } finally {
    sel.disabled = false;
  }
}

function getStockEditState(p) {
  let edit = state.stockEdits.get(p.id);
  if (!edit) {
    edit = { matrix: { ...(p.stock_matrix || {}) }, status: p.stock_status || 'available', dirty: false };
    state.stockEdits.set(p.id, edit);
  }
  return edit;
}

function renderStock() {
  const host = document.getElementById('shopAdminStockHost');
  if (!host) return;
  const q = state.stockSearch;
  let list = state.products.slice();
  if (q) list = list.filter((p) => `${p.name} ${p.sub || ''} ${p.id}`.toLowerCase().includes(q));

  if (list.length === 0) {
    host.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><h4>ไม่พบสินค้า</h4></div>`;
    return;
  }

  // Precompute reserved-per-variant once for the whole tab so we don't
  // walk state.orders per cell. Re-used in stockCardHtml for the per-
  // cell badge + the "available" computation.
  const reservedMap = computeVariantReservedMap();
  host.innerHTML = list.map((p) => stockCardHtml(p, reservedMap)).join('');

  host.querySelectorAll('[data-stock-cell]').forEach((input) => {
    // `input` only syncs state + enables Save — it MUST NOT re-render,
    // or the focused field is destroyed and the mobile keyboard dismisses
    // after a single keystroke. We deliberately don't re-render on blur
    // either: doing so eats the subsequent Save-button tap on touch. The
    // derived numbers (พร้อมขาย / เหลือ / จอง) refresh on the next natural
    // render — Save, the +/- step buttons, or a tab switch.
    input.addEventListener('input', () => onStockCellInput(input));
  });
  host.querySelectorAll('[data-stock-step]').forEach((btn) => {
    btn.addEventListener('click', () => stepStock(btn));
  });
  host.querySelectorAll('[data-stock-status-sel]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const p = state.products.find((x) => x.id === sel.dataset.stockStatusSel);
      if (!p) return;
      const edit = getStockEditState(p);
      edit.status = sel.value;
      edit.dirty = true;
      renderStock();
    });
  });
  host.querySelectorAll('[data-stock-production-sel]').forEach((sel) => {
    sel.addEventListener('change', () => onStockProductionStatusChange(sel));
  });
  host.querySelectorAll('[data-stock-save]').forEach((btn) => {
    btn.addEventListener('click', () => saveStock(btn.dataset.stockSave));
  });
  host.querySelectorAll('[data-stock-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.stockEdits.delete(btn.dataset.stockCancel);
      renderStock();
    });
  });
}

function stockCardHtml(p, reservedMap = new Map()) {
  const edit = getStockEditState(p);
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const colors = (p.colors && p.colors.length) ? p.colors : [{ id: 'default', label: 'มาตรฐาน', hex: '#ccc' }];
  const total = totalStock(edit.matrix);
  const statusMeta = STOCK_STATUS_META[edit.status] || STOCK_STATUS_META.available;
  const sales = computeProductSales(p.id);
  const prod = p.production_status || 'pending';
  return `
    <div class="stock-card ${edit.dirty ? 'is-dirty' : ''}">
      <div class="stock-card-head">
        <div class="stock-card-thumb" style="${stockThumbStyle(p)}"></div>
        <div class="flex-grow-1" style="min-width:0;">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h5 class="mb-0 font-prompt" style="font-weight:700;">${escHtml(p.name)}</h5>
            <span class="badge ${statusMeta.badgeCls}">${escHtml(statusMeta.label)}</span>
            ${edit.dirty ? '<span class="badge bg-warning-subtle text-warning border">มีการแก้ไขที่ยังไม่บันทึก</span>' : ''}
          </div>
          <div class="small text-muted">${escHtml(p.sub || '')}</div>
        </div>
        <div class="d-flex flex-column align-items-end gap-1" style="min-width:160px;">
          ${total === null ? `
            <span class="stock-total is-unset">— ยังไม่ตั้งสต็อก —</span>
          ` : (() => {
            const available = total - sales.outstanding;
            const cls = available < 0 ? 'is-over'
              : available === 0 ? 'is-zero'
              : available <= 5 ? 'is-low'
              : 'is-ok';
            return `<span class="stock-available-headline ${cls}">
              พร้อมขาย <b>${available}</b> ชิ้น
            </span>`;
          })()}
          <select class="form-select form-select-sm" data-stock-status-sel="${escHtml(p.id)}" style="max-width:200px;">
            ${STOCK_STATUSES.map((s) =>
              `<option value="${s}" ${edit.status === s ? 'selected' : ''}>${escHtml(STOCK_STATUS_META[s]?.label || s)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Compact secondary line: the supporting numbers behind the
           "พร้อมขาย" headline. Lets admin see at a glance whether the
           number went down because of recent orders or shipments. -->
      ${total !== null ? `
        <div class="stock-sales-summary small text-muted mb-2">
          ในคลังรวม <b>${total}</b>
          · ลูกค้าจองอยู่ <b>${sales.outstanding}</b>${sales.outstanding > 0 ? `<span class="text-muted small ms-1">(ยังไม่ส่งมอบ)</span>` : ''}
          · ส่งมอบแล้ว <b>${sales.delivered}</b>
        </div>
      ` : ''}

      <!-- Production-status cascade — same control as the product
           editor. The detailed explanation lives in the product editor;
           here we keep just the dropdown so admin can flip it quickly.
           A small (i) tooltip hints at the cascade behaviour without
           the full paragraph. -->
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="small fw-semibold mb-0 me-1">สถานะผลิต:</label>
        <select class="form-select form-select-sm" data-stock-production-sel="${escHtml(p.id)}" style="max-width:280px;">
          <option value="pending"   ${prod === 'pending'   ? 'selected' : ''}>ยังไม่ผลิต</option>
          <option value="produced"  ${prod === 'produced'  ? 'selected' : ''}>ผลิตเสร็จแล้ว</option>
          <option value="announced" ${prod === 'announced' ? 'selected' : ''}>ประกาศรับสินค้า</option>
        </select>
        <i class="bi bi-info-circle text-muted" tabindex="0"
           title='"ผลิตเสร็จแล้ว" ย้ายออเดอร์ "ยืนยันชำระเงิน" → "ผลิตเสร็จ" / "ประกาศรับสินค้า" ย้ายต่อไป "ประกาศแล้ว" / สถานะปัญหาไม่ถูกแตะ'></i>
      </div>
      <div class="stock-grid">
        <table class="stock-grid-table">
          <thead>
            <tr>
              <th></th>
              ${sizes.map((s) => `<th>${escHtml(s)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${colors.map((c) => `
              <tr>
                <th>
                  <span class="stock-color-swatch" style="background:${escHtml(c.hex || '#ccc')};"></span>
                  ${escHtml(c.label || c.id)}
                </th>
                ${sizes.map((s) => {
                  const k = stockKey(s, c.id);
                  const v = edit.matrix[k];
                  // Reserved = qty in active orders for this exact
                  // variant. Cancellations are excluded, so admin
                  // cancelling an order auto-frees that qty.
                  const reserved = reservedMap.get(`${p.id}|${s}|${c.id}`) || 0;
                  // Available = matrix value − reserved. Null when
                  // admin hasn't typed anything. Negative = over-sold
                  // and gets a loud red treatment so admin sees it.
                  const available = typeof v === 'number' ? v - reserved : null;
                  const wrapCls = v === undefined ? 'is-unset'
                    : v === 0 ? 'is-zero'
                    : v <= 3 ? 'is-low'
                    : 'is-ok';
                  const overSold = available !== null && available < 0;
                  return `
                    <td class="stock-cell-td">
                      <div class="stock-cell-wrap ${wrapCls} ${overSold ? 'is-over' : ''}">
                        <button type="button" class="stock-step" data-stock-step="${escHtml(p.id)}|${escHtml(k)}|-1" title="ลด 1">−</button>
                        <input class="stock-cell" data-stock-cell="${escHtml(p.id)}|${escHtml(k)}" inputmode="numeric"
                               value="${v === undefined ? '' : Number(v)}" placeholder="–" />
                        <button type="button" class="stock-step" data-stock-step="${escHtml(p.id)}|${escHtml(k)}|+1" title="เพิ่ม 1">+</button>
                      </div>
                      ${available !== null ? `
                        <div class="stock-cell-avail ${overSold ? 'is-over' : available === 0 ? 'is-zero' : available <= 3 ? 'is-low' : 'is-ok'}">
                          เหลือ ${available}
                        </div>` : ''}
                      ${reserved > 0 ? `<div class="stock-cell-reserved">จอง ${reserved}</div>` : ''}
                    </td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="stock-card-foot">
        <div class="small text-muted">
          <i class="bi bi-info-circle me-1"></i>
          ช่อง = ของในคลัง · ใต้ช่อง = พร้อมขาย (คลัง − จอง). ติดลบ = ขายเกิน
        </div>
        <div class="d-flex gap-2">
          ${edit.dirty ? `<button class="btn btn-ghost btn-sm" data-stock-cancel="${escHtml(p.id)}">ยกเลิก</button>` : ''}
          <button class="btn btn-shop btn-sm ${edit.dirty ? '' : 'disabled'}" data-stock-save="${escHtml(p.id)}" ${edit.dirty ? '' : 'disabled'}>
            <i class="bi bi-save me-1"></i> บันทึก
          </button>
        </div>
      </div>
    </div>`;
}

function stockThumbStyle(p) {
  if (p?.image_url) return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

/** Live keystroke handler — updates the pending edit + enables Save
 *  WITHOUT re-rendering, so the focused input (and the mobile keyboard)
 *  survive. The full derived-number refresh happens on blur (`change`). */
function onStockCellInput(input) {
  const [pid, key] = input.dataset.stockCell.split('|');
  const p = state.products.find((x) => x.id === pid);
  if (!p) return;
  const edit = getStockEditState(p);
  const raw = input.value.trim();
  if (raw === '') { delete edit.matrix[key]; }
  else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    edit.matrix[key] = Math.floor(n);
  }
  edit.dirty = true;
  // Enable Save + flag the card dirty in place (no re-render → no focus loss).
  input.closest('.stock-card')?.classList.add('is-dirty');
  const save = document.querySelector(`[data-stock-save="${CSS.escape(pid)}"]`);
  if (save) { save.classList.remove('disabled'); save.removeAttribute('disabled'); }
}

function stepStock(btn) {
  const [pid, key, deltaStr] = btn.dataset.stockStep.split('|');
  const p = state.products.find((x) => x.id === pid);
  if (!p) return;
  const edit = getStockEditState(p);
  const cur = edit.matrix[key];
  const delta = Number(deltaStr);
  const next = Math.max(0, (typeof cur === 'number' ? cur : 0) + delta);
  edit.matrix[key] = next;
  edit.dirty = true;
  renderStock();
}

async function saveStock(productId) {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const edit = state.stockEdits.get(productId);
  if (!edit || !edit.dirty) return;
  try {
    const { data, error } = await dbRest(
      `/shop_products?id=eq.${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        body: { stock_matrix: edit.matrix, stock_status: edit.status },
        prefer: 'return=representation',
      },
    );
    if (error) throw new Error(error.message || 'บันทึกล้มเหลว');
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('บันทึกล้มเหลว (RLS หรือสิทธิ์ไม่พอ)');
    }
    // Reflect into local cache + clear dirty flag
    p.stock_matrix = edit.matrix;
    p.stock_status = edit.status;
    state.stockEdits.delete(productId);
    showShopToast(`บันทึก "${p.name}" แล้ว`, 'success');
    renderStock();
  } catch (e) {
    showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error');
  }
}

// ---------------------------------------------------------------------
// QR settings
// ---------------------------------------------------------------------
async function loadSettingsIntoForm() {
  try {
    state.settings = await getSettings();
  } catch (e) { showShopToast(`โหลดการตั้งค่าล้มเหลว: ${e.message || e}`, 'error'); return; }
  const s = state.settings || {};
  setVal('shopAdminQRName', s.promptpay_name);
  setVal('shopAdminQRId', s.promptpay_id);
  setVal('shopAdminQRInstructions', s.instructions);
  setVal('shopAdminQRContactGmail', s.contact_gmail);
  setVal('shopAdminQRContactInstagram', s.contact_instagram);
  const preview = document.getElementById('shopAdminQRPreview');
  if (preview) {
    if (s.promptpay_qr_url) {
      preview.innerHTML = `<img src="${safeUrl(s.promptpay_qr_url)}" alt="PromptPay QR" />`;
    } else {
      preview.innerHTML = `<div class="text-center"><i class="bi bi-qr-code fs-1 text-muted"></i><div class="mt-1">ยังไม่ได้อัปโหลด</div></div>`;
    }
  }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

async function onQRFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn'); return; }
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  const fileName = `promptpay_${Date.now()}.${ext}`;
  try {
    const url = await uploadShopFile(file, 'Shop/QR', { fileName });
    const patch = { promptpay_qr_url: url };
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    const preview = document.getElementById('shopAdminQRPreview');
    if (preview) preview.innerHTML = `<img src="${safeUrl(url)}" alt="PromptPay QR" />`;
    showShopToast('อัปโหลด QR สำเร็จ', 'success');
  } catch (err) {
    showShopToast(`อัปโหลด QR ล้มเหลว: ${err.message || err}`, 'error');
  } finally {
    e.target.value = '';
  }
}

async function saveSettingsForm() {
  const patch = {
    promptpay_name: document.getElementById('shopAdminQRName')?.value || '',
    promptpay_id: document.getElementById('shopAdminQRId')?.value || '',
    instructions: document.getElementById('shopAdminQRInstructions')?.value || '',
    contact_gmail: document.getElementById('shopAdminQRContactGmail')?.value || '',
    contact_instagram: document.getElementById('shopAdminQRContactInstagram')?.value || '',
  };
  try {
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    showShopToast('บันทึกการตั้งค่าแล้ว', 'success');
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

// =====================================================================
// CATALOG CONFIG MANAGERS (migration 0057)
//   - Product types   → #shopAdminTypesHost  (catalog pane)
//   - Pickup locations → #shopAdminPickupHost (catalog pane)
//   - PromptPay QRs    → #shopAdminQrListHost (qr pane)
// Each is a small render-then-rewire card following the batch-editor
// pattern. refreshCatalogConfig() (above) reloads the lists into both
// admin state and the shared data.js caches after every mutation.
// =====================================================================

async function refreshCatalog() {
  await refreshCatalogConfig();
  renderTypesManager();
  renderPickupManager();
}

/** Parse to an integer, preserving a legitimate 0 (unlike `Number(x) || d`,
 *  which would coerce 0 to the default). Falls back to `d` for empty/NaN. */
function intOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ---- Product types ---------------------------------------------------

function renderTypesManager() {
  const host = document.getElementById('shopAdminTypesHost');
  if (!host) return;
  const rows = state.productTypes || [];
  const ed = state.typeEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-tags me-2 text-accent"></i>ประเภทสินค้า</h5>
      <button class="btn btn-shop btn-sm" data-type-add><i class="bi bi-plus-lg me-1"></i> เพิ่มประเภท</button>
    </div>
    ${ed ? typeEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีประเภท — กด "เพิ่มประเภท"</li>' :
        rows.map((t) => `
        <li class="list-group-item d-flex align-items-center gap-3" data-type-row="${escHtml(t.id)}">
          <i class="bi ${escHtml(t.icon || 'bi-tag')}"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(t.label)}</div>
            <div class="small text-muted font-mono">${escHtml(t.id)}</div>
          </div>
          ${t.is_active
            ? '<span class="badge bg-success-subtle text-success border border-success-subtle">เปิด</span>'
            : '<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>'}
          <button class="btn btn-sm btn-ghost" data-type-edit="${escHtml(t.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-type-del="${escHtml(t.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-type-add]')?.addEventListener('click', () => {
    state.typeEditor = { id: '', label: '', icon: 'bi-tag', sort_order: (rows.length + 1) * 10, is_active: true, _new: true };
    renderTypesManager();
  });
  host.querySelectorAll('[data-type-edit]').forEach((b) => b.addEventListener('click', () => {
    const t = rows.find((x) => x.id === b.dataset.typeEdit);
    if (t) { state.typeEditor = { ...t, _new: false }; renderTypesManager(); }
  }));
  host.querySelectorAll('[data-type-del]').forEach((b) => b.addEventListener('click', () => onTypeDelete(b.dataset.typeDel)));
  if (ed) wireTypeEditor();
}

function typeEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-5">
          <label class="small text-muted mb-1">ชื่อประเภท</label>
          <input id="shopTypeLabel" class="form-control" value="${escHtml(ed.label)}" />
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">ไอคอน (bootstrap-icon)</label>
          <div class="input-group">
            <span class="input-group-text"><i class="bi ${escHtml(ed.icon || 'bi-tag')}" id="shopTypeIconPreview"></i></span>
            <input id="shopTypeIcon" class="form-control font-mono" value="${escHtml(ed.icon || 'bi-tag')}" placeholder="bi-tag" />
          </div>
          <div class="form-text">ดูรายชื่อที่ icons.getbootstrap.com</div>
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ลำดับ</label>
          <input id="shopTypeSort" type="number" class="form-control" value="${Number(ed.sort_order) || 100}" />
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopTypeActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopTypeActive" class="form-check-label">เปิดใช้งาน (แสดงเป็นตัวกรองให้ลูกค้า)</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-type-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-type-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

function wireTypeEditor() {
  const icon = document.getElementById('shopTypeIcon');
  const prev = document.getElementById('shopTypeIconPreview');
  icon?.addEventListener('input', () => { if (prev) prev.className = `bi ${icon.value.trim() || 'bi-tag'}`; });
  document.querySelector('[data-type-cancel]')?.addEventListener('click', () => { state.typeEditor = null; renderTypesManager(); });
  document.querySelector('[data-type-save]')?.addEventListener('click', onTypeSave);
}

async function onTypeSave() {
  const ed = state.typeEditor;
  if (!ed) return;
  const label = document.getElementById('shopTypeLabel')?.value.trim() || '';
  if (!label) { showShopToast('กรอกชื่อประเภทก่อน', 'warn'); return; }
  // New rows get a slug id derived from the label; existing rows keep theirs
  // (the id is what products reference).
  let id = ed._new ? slugify(label) : ed.id;
  if (ed._new && state.productTypes.some((t) => t.id === id)) id = `${id}-${Math.floor(Math.random() * 999)}`;
  const row = {
    id,
    label,
    icon: document.getElementById('shopTypeIcon')?.value.trim() || 'bi-tag',
    sort_order: intOr(document.getElementById('shopTypeSort')?.value, 100),
    is_active: !!document.getElementById('shopTypeActive')?.checked,
  };
  try {
    await upsertProductType(row);
    showShopToast('บันทึกประเภทแล้ว', 'success');
    state.typeEditor = null;
    await refreshCatalog();
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onTypeDelete(id) {
  const inUse = (state.products || []).filter((p) => p.type === id).length;
  const warn = inUse > 0
    ? `\n\nมีสินค้า ${inUse} รายการใช้ประเภทนี้อยู่ — สินค้าจะยังอยู่ แต่จะแสดงรหัสประเภทแทนชื่อ`
    : '';
  if (!confirm(`ลบประเภท "${id}"?${warn}`)) return;
  try {
    await deleteProductType(id);
    showShopToast('ลบประเภทแล้ว', 'success');
    await refreshCatalog();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

// ---- Pickup locations ------------------------------------------------

function renderPickupManager() {
  const host = document.getElementById('shopAdminPickupHost');
  if (!host) return;
  const rows = state.pickupLocations || [];
  const ed = state.pickupEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-geo-alt me-2 text-accent"></i>สถานที่รับสินค้า</h5>
      <button class="btn btn-shop btn-sm" data-pickup-add><i class="bi bi-plus-lg me-1"></i> เพิ่มสถานที่</button>
    </div>
    ${ed ? pickupEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีสถานที่ — กด "เพิ่มสถานที่"</li>' :
        rows.map((l) => `
        <li class="list-group-item d-flex align-items-start gap-3" data-pickup-row="${escHtml(l.id)}">
          <i class="bi bi-geo-alt mt-1"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(l.label)}</div>
            ${l.detail ? `<div class="small text-muted" style="white-space:pre-wrap;">${escHtml(l.detail)}</div>` : ''}
          </div>
          ${l.is_active
            ? '<span class="badge bg-success-subtle text-success border border-success-subtle">เปิด</span>'
            : '<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>'}
          <button class="btn btn-sm btn-ghost" data-pickup-edit="${escHtml(l.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-pickup-del="${escHtml(l.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-pickup-add]')?.addEventListener('click', () => {
    state.pickupEditor = { id: null, label: '', detail: '', sort_order: (rows.length + 1) * 10, is_active: true };
    renderPickupManager();
  });
  host.querySelectorAll('[data-pickup-edit]').forEach((b) => b.addEventListener('click', () => {
    const l = rows.find((x) => String(x.id) === b.dataset.pickupEdit);
    if (l) { state.pickupEditor = { ...l }; renderPickupManager(); }
  }));
  host.querySelectorAll('[data-pickup-del]').forEach((b) => b.addEventListener('click', () => onPickupDelete(b.dataset.pickupDel)));
  if (ed) {
    document.querySelector('[data-pickup-cancel]')?.addEventListener('click', () => { state.pickupEditor = null; renderPickupManager(); });
    document.querySelector('[data-pickup-save]')?.addEventListener('click', onPickupSave);
  }
}

function pickupEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อสถานที่ (สั้น)</label>
          <input id="shopPickupLabel" class="form-control" value="${escHtml(ed.label)}" placeholder="เช่น ห้อง SAMO คณะแพทย์" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ลำดับ</label>
          <input id="shopPickupSort" type="number" class="form-control" value="${Number(ed.sort_order) || 100}" />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">รายละเอียด / วิธีเดินทาง (ไม่บังคับ)</label>
          <textarea id="shopPickupDetail" class="form-control" rows="2">${escHtml(ed.detail || '')}</textarea>
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopPickupActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopPickupActive" class="form-check-label">เปิดใช้งาน</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-pickup-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-pickup-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

async function onPickupSave() {
  const ed = state.pickupEditor;
  if (!ed) return;
  const label = document.getElementById('shopPickupLabel')?.value.trim() || '';
  if (!label) { showShopToast('กรอกชื่อสถานที่ก่อน', 'warn'); return; }
  const row = {
    ...(ed.id != null ? { id: ed.id } : {}),
    label,
    detail: document.getElementById('shopPickupDetail')?.value.trim() || '',
    sort_order: intOr(document.getElementById('shopPickupSort')?.value, 100),
    is_active: !!document.getElementById('shopPickupActive')?.checked,
  };
  try {
    await upsertPickupLocation(row);
    showShopToast('บันทึกสถานที่แล้ว', 'success');
    state.pickupEditor = null;
    await refreshCatalog();
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onPickupDelete(id) {
  const inUse = (state.products || []).filter((p) => String(p.pickup_location_id) === String(id)).length;
  const warn = inUse > 0 ? `\n\nมีสินค้า ${inUse} รายการใช้สถานที่นี้ — จะถูกตั้งกลับเป็น "ไม่ระบุ"` : '';
  if (!confirm(`ลบสถานที่นี้?${warn}`)) return;
  try {
    await deletePickupLocation(id);
    showShopToast('ลบสถานที่แล้ว', 'success');
    await refreshCatalog();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

// ---- PromptPay QR list -----------------------------------------------

async function refreshQrList() {
  const qrs = await listPromptpayQrs({ activeOnly: false }).catch(() => []);
  state.promptpayQrs = qrs;
  setPromptpayQrs(qrs);
  renderQrList();
}

function renderQrList() {
  const host = document.getElementById('shopAdminQrListHost');
  if (!host) return;
  const rows = state.promptpayQrs || [];
  const ed = state.qrEditor;
  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h5 class="mb-0"><i class="bi bi-wallet2 me-2 text-accent"></i>บัญชี PromptPay</h5>
      <button class="btn btn-shop btn-sm" data-qr-add><i class="bi bi-plus-lg me-1"></i> เพิ่มบัญชี</button>
    </div>
    <p class="text-muted small">สินค้าแต่ละชิ้นเลือกบัญชีได้ในหน้าแก้ไขสินค้า — สินค้าที่ไม่ได้เลือกจะใช้ "บัญชีเริ่มต้น"</p>
    ${ed ? qrEditorHtml(ed) : ''}
    <ul class="list-group">
      ${rows.length === 0 ? '<li class="list-group-item text-muted small">ยังไม่มีบัญชี — กด "เพิ่มบัญชี"</li>' :
        rows.map((q) => `
        <li class="list-group-item d-flex align-items-center gap-3" data-qr-row="${escHtml(q.id)}">
          <div style="width:44px;height:44px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#f4f5f7;display:flex;align-items:center;justify-content:center;">
            ${q.qr_url ? `<img src="${safeUrl(q.qr_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : '<i class="bi bi-qr-code text-muted"></i>'}
          </div>
          <div class="flex-grow-1">
            <div style="font-weight:600;">${escHtml(q.label || q.promptpay_name || ('บัญชี #' + q.id))}
              ${q.is_default ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1">เริ่มต้น</span>' : ''}
              ${q.is_active ? '' : '<span class="badge bg-secondary-subtle text-secondary border ms-1">ปิด</span>'}
            </div>
            <div class="small text-muted">${escHtml(q.promptpay_name || '')} · <span class="font-mono">${escHtml(q.promptpay_id || '—')}</span></div>
          </div>
          ${q.is_default ? '' : `<button class="btn btn-sm btn-ghost" data-qr-default="${escHtml(q.id)}" title="ตั้งเป็นค่าเริ่มต้น"><i class="bi bi-star"></i></button>`}
          <button class="btn btn-sm btn-ghost" data-qr-edit="${escHtml(q.id)}"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-ghost text-danger" data-qr-del="${escHtml(q.id)}"><i class="bi bi-trash3"></i></button>
        </li>`).join('')}
    </ul>`;

  host.querySelector('[data-qr-add]')?.addEventListener('click', () => {
    state.qrEditor = { id: null, label: '', promptpay_name: '', promptpay_id: '', qr_url: '', instructions: '', is_active: true, sort_order: (rows.length + 1) * 10 };
    renderQrList();
  });
  host.querySelectorAll('[data-qr-edit]').forEach((b) => b.addEventListener('click', () => {
    const q = rows.find((x) => String(x.id) === b.dataset.qrEdit);
    if (q) { state.qrEditor = { ...q }; renderQrList(); }
  }));
  host.querySelectorAll('[data-qr-default]').forEach((b) => b.addEventListener('click', () => onQrSetDefault(b.dataset.qrDefault)));
  host.querySelectorAll('[data-qr-del]').forEach((b) => b.addEventListener('click', () => onQrDelete(b.dataset.qrDel)));
  if (ed) wireQrEditor();
}

function qrEditorHtml(ed) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <div class="row g-2">
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อบัญชี (สำหรับแอดมิน)</label>
          <input id="shopQrLabel" class="form-control" value="${escHtml(ed.label || '')}" placeholder="เช่น บัญชี MD" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ชื่อผู้รับเงิน (แสดงให้ลูกค้า)</label>
          <input id="shopQrName" class="form-control" value="${escHtml(ed.promptpay_name || '')}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">PromptPay (เบอร์ / เลขผู้เสียภาษี)</label>
          <input id="shopQrId" class="form-control font-mono" value="${escHtml(ed.promptpay_id || '')}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูป QR</label>
          <div class="d-flex gap-2 align-items-center">
            <div style="width:64px;height:64px;flex:0 0 auto;border-radius:6px;overflow:hidden;background:#f4f5f7;display:flex;align-items:center;justify-content:center;" id="shopQrPreview">
              ${ed.qr_url ? `<img src="${safeUrl(ed.qr_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : '<i class="bi bi-qr-code text-muted fs-4"></i>'}
            </div>
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-cloud-upload me-1"></i> ${ed.qr_url ? 'เปลี่ยนรูป' : 'อัปโหลด'}
              <input id="shopQrFile" type="file" accept="image/*" hidden />
            </label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">คำสั่งเฉพาะบัญชีนี้ (ไม่บังคับ — ว่าง = ใช้ข้อความรวมด้านล่าง)</label>
          <textarea id="shopQrInstructions" class="form-control" rows="2">${escHtml(ed.instructions || '')}</textarea>
        </div>
        <div class="col-12">
          <div class="form-check">
            <input id="shopQrActive" class="form-check-input" type="checkbox" ${ed.is_active ? 'checked' : ''} />
            <label for="shopQrActive" class="form-check-label">เปิดใช้งาน</label>
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-2">
        <button class="btn btn-ghost btn-sm" data-qr-cancel>ยกเลิก</button>
        <button class="btn btn-shop btn-sm" data-qr-save><i class="bi bi-save me-1"></i> บันทึก</button>
      </div>
    </div>`;
}

function wireQrEditor() {
  document.getElementById('shopQrFile')?.addEventListener('change', onQrEditorFileChosen);
  document.querySelector('[data-qr-cancel]')?.addEventListener('click', () => { state.qrEditor = null; renderQrList(); });
  document.querySelector('[data-qr-save]')?.addEventListener('click', onQrSave);
}

async function onQrEditorFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn'); return; }
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  try {
    const url = await uploadShopFile(file, 'Shop/QR', { fileName: `promptpay_${Date.now()}.${ext}` });
    if (state.qrEditor) state.qrEditor.qr_url = url;
    const prev = document.getElementById('shopQrPreview');
    if (prev) prev.innerHTML = `<img src="${safeUrl(url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />`;
    showShopToast('อัปโหลด QR สำเร็จ', 'success');
  } catch (err) {
    showShopToast(`อัปโหลดล้มเหลว: ${err.message || err}`, 'error');
  } finally { e.target.value = ''; }
}

async function onQrSave() {
  const ed = state.qrEditor;
  if (!ed) return;
  const name = document.getElementById('shopQrName')?.value.trim() || '';
  const ppId = document.getElementById('shopQrId')?.value.trim() || '';
  if (!name && !ppId) { showShopToast('กรอกชื่อผู้รับเงินหรือเลข PromptPay อย่างน้อยหนึ่งอย่าง', 'warn'); return; }
  const row = {
    ...(ed.id != null ? { id: ed.id } : {}),
    label: document.getElementById('shopQrLabel')?.value.trim() || '',
    promptpay_name: name,
    promptpay_id: ppId,
    qr_url: ed.qr_url || null,
    instructions: document.getElementById('shopQrInstructions')?.value.trim() || '',
    is_active: !!document.getElementById('shopQrActive')?.checked,
    sort_order: intOr(ed.sort_order, 100),
  };
  try {
    await upsertPromptpayQr(row);
    showShopToast('บันทึกบัญชีแล้ว', 'success');
    state.qrEditor = null;
    await refreshQrList();
    setPromptpayQrs(state.promptpayQrs);
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onQrSetDefault(id) {
  try {
    await setDefaultQr(id);
    showShopToast('ตั้งเป็นบัญชีเริ่มต้นแล้ว', 'success');
    await refreshQrList();
  } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onQrDelete(id) {
  const q = (state.promptpayQrs || []).find((x) => String(x.id) === String(id));
  if (q?.is_default) { showShopToast('ตั้งบัญชีอื่นเป็นค่าเริ่มต้นก่อนจึงจะลบได้', 'warn'); return; }
  const inUse = (state.products || []).filter((p) => String(p.promptpay_qr_id) === String(id)).length;
  const warn = inUse > 0 ? `\n\nมีสินค้า ${inUse} รายการใช้บัญชีนี้ — จะถูกตั้งกลับเป็นบัญชีเริ่มต้น` : '';
  if (!confirm(`ลบบัญชีนี้?${warn}`)) return;
  try {
    await deletePromptpayQr(id);
    showShopToast('ลบบัญชีแล้ว', 'success');
    await refreshQrList();
  } catch (e) { showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error'); }
}

// =====================================================================
// BANNERS — admin-curated hero carousel for the shop landing
// =====================================================================

let _bannerSortable = null;

async function refreshBanners() {
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  try {
    const banners = await listShopBanners({ activeOnly: false });
    state.banners = banners;
    renderBannerList();
  } catch (e) {
    list.innerHTML = `<li class="list-group-item text-danger small">โหลดล้มเหลว: ${escHtml(e.message || e)}</li>`;
  }
}

function renderBannerList() {
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  const placement = state.bannerPlacement || 'launch';
  // Reflect the active placement on the toggle.
  document.querySelectorAll('#shopAdminBannerPlacement [data-banner-placement]')
    .forEach((b) => b.classList.toggle('active', b.dataset.bannerPlacement === placement));
  const items = (state.banners || []).filter((b) => (b.placement || 'launch') === placement);
  if (items.length === 0) {
    const hint = placement === 'announcement'
      ? 'ยังไม่มีแบนเนอร์ประกาศ — กด "เพิ่มแบนเนอร์" เพื่อเริ่มต้น'
      : 'ยังไม่มีแบนเนอร์เปิดตัว — กด "เพิ่มแบนเนอร์" เพื่อเริ่มต้น';
    list.innerHTML = `<li class="list-group-item text-muted small">${hint}</li>`;
    if (_bannerSortable) { try { _bannerSortable.destroy(); } catch { /* noop */ } _bannerSortable = null; }
    return;
  }
  list.innerHTML = items.map((b) => `
    <li class="list-group-item d-flex align-items-center gap-3 flex-wrap" data-banner-id="${escHtml(b.id)}">
      <span class="banner-handle" style="cursor:grab;" aria-label="ลากเพื่อจัดเรียง">
        <i class="bi bi-grip-vertical fs-5 text-muted"></i>
      </span>
      <img src="${safeUrl(convertDriveUrl(b.image_url))}" alt=""
        style="width:120px; aspect-ratio:21/9; object-fit:cover; border-radius:6px; flex-shrink:0; background:#f5f5f5;">
      <div class="flex-grow-1" style="min-width:200px;">
        <input class="form-control form-control-sm banner-caption mb-1"
          placeholder="ข้อความบนแบนเนอร์ (ไม่บังคับ)"
          value="${escHtml(b.caption || '')}" data-banner-id="${escHtml(b.id)}" />
        <input class="form-control form-control-sm banner-link"
          placeholder="ลิงก์เมื่อกด (ไม่บังคับ — เช่น /shop หรือ URL ภายนอก)"
          value="${escHtml(b.link_url || '')}" data-banner-id="${escHtml(b.id)}" />
      </div>
      <div class="form-check form-switch flex-shrink-0" title="${b.is_active ? 'กำลังแสดงในหน้าร้าน' : 'ซ่อนอยู่'}">
        <input class="form-check-input banner-active" type="checkbox"
          ${b.is_active ? 'checked' : ''} data-banner-id="${escHtml(b.id)}">
        <label class="form-check-label small text-muted">${b.is_active ? 'แสดง' : 'ซ่อน'}</label>
      </div>
      <button class="btn btn-sm btn-outline-danger banner-delete" data-banner-id="${escHtml(b.id)}"
        aria-label="ลบแบนเนอร์">
        <i class="bi bi-trash3"></i>
      </button>
    </li>
  `).join('');

  // SortableJS — re-create on each render so the new <li>s are picked up.
  if (_bannerSortable) { try { _bannerSortable.destroy(); } catch { /* noop */ } _bannerSortable = null; }
  if (window.Sortable) {
    _bannerSortable = window.Sortable.create(list, {
      handle: '.banner-handle',
      animation: 150,
      onEnd: async () => {
        const ids = Array.from(list.querySelectorAll('[data-banner-id]'))
          .map((li) => li.dataset.bannerId)
          .filter(Boolean);
        try {
          await reorderShopBanners(ids);
          await refreshBanners();
          showShopToast('จัดเรียงแบนเนอร์แล้ว', 'success');
        } catch (e) {
          showShopToast(`จัดเรียงล้มเหลว: ${e.message || e}`, 'error');
        }
      },
    });
  }
}

function wireBanners() {
  document.getElementById('shopAdminBannerAdd')?.addEventListener('click', () => {
    document.getElementById('shopAdminBannerFile')?.click();
  });
  document.getElementById('shopAdminBannerFile')?.addEventListener('change', onBannerFilePicked);
  // Placement toggle: switch which banner set (launch / announcement)
  // is being managed. Re-renders from the already-loaded state.banners.
  document.getElementById('shopAdminBannerPlacement')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-banner-placement]');
    if (!btn) return;
    const next = btn.dataset.bannerPlacement;
    if (next === state.bannerPlacement) return;
    state.bannerPlacement = next;
    renderBannerList();
  });
  const list = document.getElementById('shopAdminBannersList');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const del = e.target.closest('.banner-delete');
    if (del) onBannerDelete(del.dataset.bannerId);
  });
  list.addEventListener('change', (e) => {
    const sw = e.target.closest('.banner-active');
    if (sw) onBannerActiveToggle(sw.dataset.bannerId, sw.checked);
  });
  // Save caption / link on blur to avoid a PATCH-per-keystroke.
  list.addEventListener('blur', (e) => {
    const cap = e.target.closest?.('.banner-caption');
    if (cap) onBannerCaptionChange(cap.dataset.bannerId, cap.value);
    const lnk = e.target.closest?.('.banner-link');
    if (lnk) onBannerLinkChange(lnk.dataset.bannerId, lnk.value);
  }, true);
}

async function onBannerFilePicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const addBtn = document.getElementById('shopAdminBannerAdd');
  const originalLabel = addBtn?.innerHTML;
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  try {
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
    const fileName = `banner_${Date.now()}.${ext}`;
    const imageUrl = await uploadShopFile(file, 'Shop/Banners', { fileName });
    const placement = state.bannerPlacement || 'launch';
    // display_order is per-placement — only count banners in this set.
    const maxOrder = (state.banners || [])
      .filter((b) => (b.placement || 'launch') === placement)
      .reduce((m, b) => Math.max(m, b.display_order || 0), -1);
    await createShopBanner({
      image_url: imageUrl,
      display_order: maxOrder + 1,
      is_active: true,
      placement,
    });
    await refreshBanners();
    showShopToast('เพิ่มแบนเนอร์แล้ว', 'success');
  } catch (err) {
    showShopToast(`อัปโหลดล้มเหลว: ${err.message || err}`, 'error');
  } finally {
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.innerHTML = originalLabel || '<i class="bi bi-plus-lg me-1"></i> เพิ่มแบนเนอร์';
    }
  }
}

async function onBannerDelete(id) {
  if (!confirm('ลบแบนเนอร์นี้?')) return;
  try {
    await deleteShopBanner(id);
    await refreshBanners();
    showShopToast('ลบแล้ว', 'success');
  } catch (e) {
    showShopToast(`ลบล้มเหลว: ${e.message || e}`, 'error');
  }
}

async function onBannerActiveToggle(id, active) {
  try {
    await updateShopBanner(id, { is_active: active });
    const b = (state.banners || []).find((x) => x.id === id);
    if (b) b.is_active = active;
    // Re-render to update the "แสดง"/"ซ่อน" label
    renderBannerList();
  } catch (e) {
    showShopToast(`อัปเดตล้มเหลว: ${e.message || e}`, 'error');
    refreshBanners();
  }
}

async function onBannerCaptionChange(id, caption) {
  const b = (state.banners || []).find((x) => x.id === id);
  if (!b || (b.caption || '') === caption) return;
  try {
    await updateShopBanner(id, { caption: caption || null });
    b.caption = caption;
  } catch (e) { showShopToast(`บันทึกแคปชั่นล้มเหลว: ${e.message || e}`, 'error'); }
}

async function onBannerLinkChange(id, link) {
  const b = (state.banners || []).find((x) => x.id === id);
  if (!b || (b.link_url || '') === link) return;
  try {
    await updateShopBanner(id, { link_url: link || null });
    b.link_url = link;
  } catch (e) { showShopToast(`บันทึกลิงก์ล้มเหลว: ${e.message || e}`, 'error'); }
}

// =====================================================================
// PRODUCT EDITOR — color picker helpers
// =====================================================================

function colorPickerRowsHtml(colors) {
  const list = Array.isArray(colors) ? colors : [];
  if (list.length === 0) {
    return ''; // empty — admin adds rows via the "เพิ่มสี" button
  }
  return list.map((c, i) => colorPickerRowHtml(c, i)).join('');
}

function colorPickerRowHtml(c, i) {
  const id = String(c?.id || '');
  const label = String(c?.label || '');
  const hex = sanitizeHex(c?.hex) || '#cccccc';
  return `
    <div class="shop-color-row d-flex align-items-center gap-2" data-color-row="${i}">
      <input type="color" class="form-control form-control-color shop-color-row-hex"
        value="${escHtml(hex)}" data-color-hex title="เลือกสี" />
      <input type="text" class="form-control shop-color-row-label"
        value="${escHtml(label)}" placeholder="ชื่อสี (เช่น แดง, ขาว)" data-color-label />
      <input type="text" class="form-control font-mono shop-color-row-id"
        value="${escHtml(id)}" placeholder="id (ไม่บังคับ)" data-color-id
        style="max-width:110px;" />
      <button type="button" class="btn btn-ghost btn-sm" data-color-remove title="ลบสีนี้">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>`;
}

function readColorRows() {
  const list = document.getElementById('shopProdColorsList');
  if (!list) return [];
  const rows = list.querySelectorAll('.shop-color-row');
  const out = [];
  rows.forEach((row) => {
    const hex = sanitizeHex(row.querySelector('[data-color-hex]')?.value) || '#cccccc';
    const label = (row.querySelector('[data-color-label]')?.value || '').trim();
    const rawId = (row.querySelector('[data-color-id]')?.value || '').trim();
    // Skip totally empty rows so accidental "add" doesn't leak.
    if (!label && !rawId) return;
    const id = rawId || slugify(label);
    out.push({ id, label: label || id, hex });
  });
  return out;
}

function sanitizeHex(s) {
  if (!s) return '';
  const v = String(s).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : '';
}
