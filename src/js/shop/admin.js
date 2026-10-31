// ==============================================
// SHOP ADMIN — Orders, slip verify, preorder demand, batches, products, QR
//
// Mounted inside #adminShopSection within tab-admin.html. Driven by the
// existing openAdminSection('shop') hook (added in main.js).
// ==============================================

import { getUser } from '../auth.js';
import {
  setShopTypes, setPromptpayQrs, setPickupLocations, orderMatchesYearFilter,
} from './data.js';
import { fetchSamoYears, currentSamoYear, samoYearOptionsHtml, ALL_YEARS } from '../samo-year.js';
import { listAllOrders, listProducts, listProductTypes, listPromptpayQrs, listPickupLocations } from './api.js';
import { showShopToast } from './products.js';
import { initSales, renderSales, setSalesLoading } from './admin-sales.js';
import {
  refreshOrders, populateStatusFacet, populateOrdersSourceFacet, populateOrdersProductSelect,
  populateOrdersSizeFacet, populateOrdersColorFacet, populateOrdersItemStatusFacet,
  repopulateOrderFacets, renderOrdersTable, toggleOrderCreate, exportOrdersCsv,
  deleteCurrentOrder, openOrderModal, filterOrders, bulkDeleteSelectedOrders,
  persistAdminNoteIfChanged, applyQuickFilter, syncBulkBar,
} from './admin-orders.js';
import { renderVerifyQueue, wireSlipImageFallback, wireVerifyKeys } from './admin-verify.js';
import { refreshPreorder, renderPreorder } from './admin-preorder.js';
import { blankBatch, refreshBatches, renderBatches } from './admin-batches.js';
import { blankProduct, refreshProducts, renderProductEditor, releasePreviews } from './admin-products.js';
import { refreshStock, renderStock } from './admin-stock.js';
import { loadSettingsIntoForm, saveSettingsForm, onQRFileChosen, refreshQrList, refreshCatalog } from './admin-catalog.js';
import { wireBanners, refreshBanners } from './admin-banners.js';

export const state = {
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
  // SAMO year filter (0230) — ONE shared picker (../samo-year.js), reused by
  // both the orders table and the ยอดขาย tab (setOrdersYear below keeps the
  // two <select>s in sync) so "2569" never means two different things in
  // two tabs of the same admin. null = not loaded yet; ALL_YEARS or a number.
  ordersYear: null,
  years: [],
  // 'all' | 'preorder' | 'in_stock' — gates the orders table on the
  // shop_orders.is_preorder flag set by place_shop_order (mig 0030).
  ordersPreorder: 'all',
  orderCreateDraft: null,  // admin "create order" inline panel state
  verifyIdx: 0,
  verifySlip: 0,          // which of the current order's slips is shown big
  verifyOrderId: null,    // the order on screen — a new one resets verifySlip
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
export function loadSourceDefault() {
  try {
    const raw = localStorage.getItem(sourceDefaultKey());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch { return []; }
}
export function saveSourceDefault(arr) {
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
export function applySourceDefaultOnce() {
  const uid = getUser()?.id;
  if (!uid || uid === sourceDefaultAppliedUid) return;
  sourceDefaultAppliedUid = uid;
  state.ordersSources = new Set(loadSourceDefault());
}

/**
 * Populate the shared SAMO-year picker (../samo-year.js) once and default to
 * the CURRENT year — same shape as pr-staff.js's loadPrStaffYears(). Both
 * the orders table and the ยอดขาย tab read ONE selection (state.ordersYear);
 * this fills both <select>s so a year picked in either tab is reflected in
 * the other without a second fetch.
 */
async function loadShopAdminYears() {
  try {
    state.years = await fetchSamoYears();
    const cur = currentSamoYear(state.years);
    if (state.ordersYear == null) state.ordersYear = cur != null ? cur : ALL_YEARS;
    const optionsHtml = `<option value="${ALL_YEARS}">ทุกปี</option>` + samoYearOptionsHtml(state.years, null);
    for (const id of ['shopAdminOrdersYearFilter', 'shopSalesYearFilter']) {
      const sel = document.getElementById(id);
      if (!sel) continue;
      sel.innerHTML = optionsHtml;
      sel.value = String(state.ordersYear);
      if (sel.value !== String(state.ordersYear)) {
        // The saved selection no longer exists among the offered years
        // (e.g. a year with zero orders left) — fail open to "ทุกปี" rather
        // than silently showing an empty table under a value the <select>
        // never actually holds.
        state.ordersYear = ALL_YEARS;
        sel.value = ALL_YEARS;
      }
    }
  } catch (e) {
    console.error('Failed to load SAMO years', e);
  }
}

/** The admin picked a different year in EITHER tab's <select> — keep both in
 *  sync and redraw whichever tab is on screen. No refetch: both tabs read
 *  from the already-loaded state.orders. */
function setOrdersYear(y) {
  syncOrdersYear(y);
  if (state.tab === 'orders') {
    repopulateOrderFacets();
    renderOrdersTable();
  } else if (state.tab === 'sales') {
    renderSales(yearFilteredOrders(), state.products);
  }
}

/** Set the year both tabs read and move both <select>s to it, without
 *  redrawing (the callers redraw once, after their own changes). */
export function syncOrdersYear(y) {
  state.ordersYear = y;
  const v = String(y);
  for (const id of ['shopAdminOrdersYearFilter', 'shopSalesYearFilter']) {
    const sel = document.getElementById(id);
    if (sel && sel.value !== v) sel.value = v;
  }
}

/** state.orders narrowed to the picked SAMO year — what the ยอดขาย tab
 *  reads (the orders table filters inside filterOrders() instead, since it
 *  combines with every other facet there). */
export function yearFilteredOrders() {
  return state.orders.filter((o) => orderMatchesYearFilter(o, state.ordersYear));
}

/** Every orders-table filter off, แหล่งที่มา included, and the controls
 *  that show them reset. Callers re-render the facets / table. */
function clearOrderFilters() {
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
}

let mounted = false;
function ensureMounted() {
  if (mounted) return;
  mounted = true;
  applySourceDefaultOnce();
  wireAutogrowFallback();
  wireVerifyKeys();
  wireSlipImageFallback();

  // Tab switcher
  document.getElementById('shopAdminTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-admin-tab]');
    if (!btn) return;
    setTab(btn.dataset.shopAdminTab);
  });

  // SAMO-year picker (0230) — one <select> per tab, both backed by
  // state.ordersYear (loadShopAdminYears / setOrdersYear above).
  for (const id of ['shopAdminOrdersYearFilter', 'shopSalesYearFilter']) {
    document.getElementById(id)?.addEventListener('change', (e) => {
      setOrdersYear(e.target.value === ALL_YEARS ? ALL_YEARS : Number(e.target.value));
    });
  }

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
    clearOrderFilters();
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

  // The order detail modal's delete button lives in the modal FOOTER
  // (modal-shop-order-detail.html), outside #shopAdminOrderModalBody — the
  // only part openOrderModal() repaints with innerHTML on every open. Wiring
  // it there (as it used to) attached one more listener per order opened, so
  // after viewing a few orders a single click fired deleteCurrentOrder()
  // that many times at once — concurrent DELETE requests for the same row,
  // duplicate toasts, and a stacked confirm dialog. Same re-render-listener
  // trap as my-house.js's; the fix is the same one: wire the static button
  // exactly ONCE, here, guarded by `mounted` like everything else in this
  // function, instead of inside the function that repaints around it.
  document.getElementById('shopAdminOrderModalDelete')?.addEventListener('click', deleteCurrentOrder);

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
    releasePreviews(state.productEditor);
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
  document.getElementById('shopSalesRefresh')?.addEventListener('click', refreshSales);
  document.getElementById('shopAdminStats')?.addEventListener('click', (e) => {
    const go = e.target.closest('[data-shop-goto]');
    if (go) { setTab(go.dataset.shopGoto); return; }
    const quick = e.target.closest('[data-shop-quick]');
    if (quick) applyQuickFilter(quick.dataset.shopQuick);
  });
}

function setTab(name) {
  state.tab = name;
  document.querySelectorAll('#shopAdminTabs [data-shop-admin-tab]').forEach((b) => {
    const on = b.dataset.shopAdminTab === name;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    // The strip scrolls sideways on a phone: keep the chosen tab in sight.
    if (on) revealTab(b);
  });
  document.querySelectorAll('#adminShopSection [data-shop-admin-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.shopAdminPane !== name));

  if (name === 'orders')   refreshOrders();
  if (name === 'verify')   renderVerifyQueue();
  if (name === 'sales')    refreshSales();
  if (name === 'preorder') refreshPreorder();
  if (name === 'batches')  refreshBatches();
  if (name === 'banners')  refreshBanners();
  if (name === 'products') refreshProducts();
  if (name === 'stock')    refreshStock();
  if (name === 'qr')       { loadSettingsIntoForm(); refreshQrList(); }
  if (name === 'catalog')  refreshCatalog();
}

/** Scroll the tab strip (not the page) so `btn` is fully visible. */
function revealTab(btn) {
  const strip = btn.parentElement;
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  const pad = 24;
  const left = btn.offsetLeft - strip.offsetLeft;
  const right = left + btn.offsetWidth;
  if (left - pad < strip.scrollLeft) strip.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
  else if (right + pad > strip.scrollLeft + strip.clientWidth) {
    strip.scrollTo({ left: right + pad - strip.clientWidth, behavior: 'smooth' });
  }
}

/** Replace the loaded orders and refresh what every tab shows about them —
 *  today, the slip-queue count on the ตรวจสลิป tab. */
export function setOrders(orders) {
  state.orders = orders || [];
  const n = state.orders.filter((o) => o.status === 'review').length;
  const badge = document.getElementById('shopAdminVerifyCount');
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.setAttribute('aria-label', `รอตรวจ ${n} รายการ`);
    badge.classList.toggle('d-none', n === 0);
  }
}

// ---------------------------------------------------------------------
// Sales (ยอดขาย) — rendering lives in admin-sales.js, the counting in sales.js
// ---------------------------------------------------------------------
let salesInFlight = null;
async function refreshSales() {
  initSales({
    sources: loadSourceDefault(),
    uid: getUser()?.id || null,
    toast: showShopToast,
    onVerify: () => setTab('verify'),
    onShowOrders: (productId) => {
      // Jump to EVERY order of this one product: all other filters cleared,
      // แหล่งที่มา included — the orders tab keeps its own (the admin's saved
      // default), and a product the sales tab just showed under ทุกแหล่ง then
      // opened an empty list.
      clearOrderFilters();
      state.ordersProducts = new Set([productId]);
      setTab('orders');
      document.getElementById('shopAdminTabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  });
  if (salesInFlight) return salesInFlight;      // one load at a time
  setSalesLoading(true);
  salesInFlight = (async () => {
    try {
      const [orders, products] = await Promise.all([
        listAllOrders(),
        listProducts({ activeOnly: false }).catch(() => state.products || []),
      ]);
      setOrders(orders);
      if (products && products.length) state.products = products;
      renderSales(yearFilteredOrders(), state.products);
    } catch (e) {
      setSalesLoading(false);
      showShopToast(`โหลดยอดขายล้มเหลว: ${e.message || e}`, 'error');
    } finally {
      salesInFlight = null;
    }
  })();
  return salesInFlight;
}

/** Text boxes that grow with what is typed (`.shop-autogrow`, shop.css). CSS
 *  `field-sizing: content` does it alone where supported; this is for browsers
 *  without it (Safari before 26 — iPads here stay on old versions). One
 *  delegated listener, so it covers editors rendered later too. A box is sized
 *  on focus as well, so saved long text shows in full once it is clicked. */
function wireAutogrowFallback() {
  if (globalThis.CSS?.supports?.('field-sizing', 'content')) return;
  const fit = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLTextAreaElement) || !t.classList.contains('shop-autogrow')) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;   // + the 1px borders
  };
  document.addEventListener('input', fit);
  document.addEventListener('focusin', fit);
}

/** Entry point — call from main.js when the shop admin section opens. */
export async function openShopAdmin() {
  ensureMounted();
  // Load the catalog-config lists (types / QRs / pickup) into the data.js
  // caches so the product editor's selects + the customer surfaces have
  // them. Best-effort — a missing 0057 migration just yields empty lists.
  await refreshCatalogConfig();
  await loadShopAdminYears();
  setTab(state.tab || 'orders');
}

/** Fetch the catalog-config lists into both admin state and the shared
 *  data.js caches. Reused by the managers after every mutation. */
export async function refreshCatalogConfig() {
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
  // A deep link names ONE order, whatever its year — set before the year
  // list loads (loadShopAdminYears keeps a non-null choice), or a past-year
  // order opens over an empty table.
  syncOrdersYear(ALL_YEARS);
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

