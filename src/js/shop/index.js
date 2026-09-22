// ==============================================
// SHOP — Entry point
//
// initShop() is called once from main.js on DOMContentLoaded. It:
//   - wires the sub-nav buttons inside #pills-shop
//   - subscribes to global auth changes (so My Orders / Checkout
//     reflect sign-in state)
//   - loads products + active pickup batch on first tab-show
//   - exposes openShopAdmin() for the admin landing-card click
// ==============================================

import { onAuthChange } from '../auth.js';
import { listProducts, listProductTypes, listPromptpayQrs, listPickupLocations } from './api.js';
import { setShopTypes, setPromptpayQrs, setPickupLocations } from './data.js';
import { mountShopBrowse, reloadShop, setShopNavigators } from './products.js';
import { mountShopCart, setCartNavigators, setShopCartProducts, showCartFab } from './cart.js';
import { mountCheckout, renderCheckout, setCheckoutNavigators } from './checkout.js';
import { mountOrdersView, renderOrdersView, refreshReadyCountBadge } from './orders.js';
import { onCartChange } from './state.js';
import { openShopAdmin, openShopAdminOrder } from './admin.js';

let view = 'shop'; // 'shop' | 'orders' | 'checkout'
let initialised = false;

/** Load the admin-managed catalog config (types / PromptPay QRs / pickup
 *  locations, migration 0057) into the data.js caches so the customer
 *  renderers can read them synchronously. Best-effort: on a missing table
 *  the api helpers warn once and return [], and the UI falls back to its
 *  built-in defaults. Exported so admin.js can reuse it. */
export async function loadCatalogConfig() {
  const [types, qrs, pickups] = await Promise.all([
    listProductTypes({ activeOnly: false }).catch(() => []),
    listPromptpayQrs({ activeOnly: false }).catch(() => []),
    listPickupLocations({ activeOnly: false }).catch(() => []),
  ]);
  setShopTypes(types);
  setPromptpayQrs(qrs);
  setPickupLocations(pickups);
}
// Track whether the shop tab itself is the active Bootstrap pane.
let shopTabActive = false;
// Track whether the cart offcanvas is open (suppresses the FAB so they don't
// overlap and so the offcanvas's own close button isn't visually shadowed).
let cartOpen = false;

function syncFab() {
  // FAB only when the shop tab is the active pane, the user isn't on the
  // Checkout view (cart is already-in-progress there), and the offcanvas
  // isn't open.
  showCartFab(shopTabActive && view !== 'checkout' && !cartOpen);
}

// Shop-only page chrome: `shop-mode` on <body> paints the storefront
// background edge-to-edge (see shop-storefront.css).
function setShopChrome(active) {
  document.body.classList.toggle('shop-mode', active);
}

function setView(next) {
  view = next;
  document.querySelectorAll('#shopSubnav [data-shop-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.shopView === next));
  document.querySelectorAll('#pills-shop [data-shop-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.shopPane !== next));
  // The Checkout sub-nav entry is only shown while a checkout is in progress
  // (i.e. user navigated there from the cart). It hides when they leave.
  const checkoutBtn = document.getElementById('shopCheckoutNavBtn');
  if (checkoutBtn) checkoutBtn.classList.toggle('d-none', next !== 'checkout');

  if (next === 'orders')   renderOrdersView();
  if (next === 'checkout') renderCheckout();
  syncFab();
}

export function initShop() {
  if (initialised) return;
  initialised = true;

  // Sub-nav button clicks
  document.getElementById('shopSubnav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-view]');
    if (!btn) return;
    setView(btn.dataset.shopView);
  });

  // Wire each sub-module's "I want to navigate to X" hooks
  setShopNavigators({ goOrders: () => setView('orders') });
  setCartNavigators({ goCheckout: () => setView('checkout') });
  setCheckoutNavigators({
    goShop: () => setView('shop'),
    afterPlace: () => setView('orders'),
  });

  mountShopBrowse();
  mountShopCart();
  mountCheckout();
  mountOrdersView();

  // Auth changes re-render orders / checkout (gates update too).
  onAuthChange(() => {
    if (view === 'orders')   renderOrdersView();
    if (view === 'checkout') renderCheckout();
  });
  // A cart re-priced (repriceCart on a product reload) or edited while the
  // checkout is open must re-draw it: the QR amount on screen is what the buyer
  // transfers. renderCheckout is a no-op while an order is being placed.
  onCartChange(() => { if (view === 'checkout') renderCheckout(); });

  // Cart offcanvas open/close → toggle the FAB so they don't overlap.
  const oc = document.getElementById('shopCartOffcanvas');
  if (oc) {
    oc.addEventListener('shown.bs.offcanvas',  () => { cartOpen = true;  syncFab(); });
    oc.addEventListener('hidden.bs.offcanvas', () => { cartOpen = false; syncFab(); });
  }

  // Lazy load on first tab show — avoids hitting Supabase on cold start
  // for users who never open the shop. We also briefly paint a loading
  // state so the grid doesn't look empty during the fetch.
  document.addEventListener('shown.bs.tab', async (e) => {
    if (e.target?.id === 'pills-shop-tab') {
      shopTabActive = true;
      setShopChrome(true);
      syncFab();
      const grid = document.getElementById('shopProductGrid');
      if (grid && grid.childElementCount === 0) {
        grid.innerHTML = '<div class="text-center text-muted py-5 grid-column: 1/-1"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดสินค้า…</div>';
      }
      // Types/QRs/pickup drive the filter chips + checkout — load them
      // before the grid renders so the type chips are correct on first paint.
      await loadCatalogConfig();
      await reloadShop();
      // Hand the freshly-loaded products (including inactive ones, since a
      // cart can hold an item whose product was later deactivated) to the
      // cart module so cart-line names + thumbnails render correctly.
      try { setShopCartProducts(await listProducts({ activeOnly: false })); } catch {}
      if (view === 'orders') {
        await renderOrdersView();
      } else {
        refreshReadyCountBadge();
      }
    } else {
      shopTabActive = false;
      setShopChrome(false);
      syncFab();
    }
  });
}

// Re-export so main.js can hand the admin landing-card click straight through.
export { openShopAdmin, openShopAdminOrder };
