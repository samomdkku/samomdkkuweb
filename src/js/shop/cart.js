// ==============================================
// SHOP CART — Offcanvas drawer + FAB count badge
//
// State lives in shop/state.js; this module just renders and wires the
// Bootstrap offcanvas + FAB. The FAB element is created lazily on first
// mount and hidden when the shop tab isn't visible.
// ==============================================

import { escHtml } from '../utils.js';
import { thb, unitPriceFor } from './data.js';
import { onCartChange, cartCount, cartSubtotal, getCart, updateQty, removeItem, repriceCart } from './state.js';
import { listProducts } from './api.js';

let productMap = {};
let onCheckout = () => {};

export function setCartNavigators({ goCheckout }) { onCheckout = goCheckout || onCheckout; }

/** Mount once (call from initShop). */
export function mountShopCart() {
  installFab();
  // Offcanvas buttons
  document.getElementById('shopCartCheckoutBtn')?.addEventListener('click', () => {
    const inst = window.bootstrap?.Offcanvas.getInstance(document.getElementById('shopCartOffcanvas'));
    inst?.hide();
    onCheckout();
  });
  // Re-render on any cart mutation. Subscriber fires immediately too.
  onCartChange(render);
}

/** Re-load product names/thumbs (called after shop products refresh). */
export function setShopCartProducts(products) {
  productMap = {};
  for (const p of (products || [])) productMap[p.id] = p;
  repriceCart((it) => (productMap[it.productId] ? unitPriceFor(productMap[it.productId], it.size) : null));
  render();
}

function installFab() {
  if (document.getElementById('shopCartFab')) return;
  const btn = document.createElement('button');
  btn.id = 'shopCartFab';
  btn.type = 'button';
  btn.className = 'shop-cart-fab d-none';
  btn.setAttribute('aria-label', 'Open cart');
  btn.innerHTML = `<i class="bi bi-bag"></i><span id="shopCartFabCount" class="cart-fab-count d-none">0</span>`;
  btn.addEventListener('click', () => {
    const oc = document.getElementById('shopCartOffcanvas');
    if (!oc || !window.bootstrap) return;
    window.bootstrap.Offcanvas.getOrCreateInstance(oc).show();
  });
  document.body.appendChild(btn);
}

export function showCartFab(show) {
  const fab = document.getElementById('shopCartFab');
  if (fab) fab.classList.toggle('d-none', !show);
}

// ---------------------------------------------------------------------
// Render: cart drawer + FAB badge
// ---------------------------------------------------------------------
function render() {
  const count = cartCount();
  const fabCount = document.getElementById('shopCartFabCount');
  if (fabCount) {
    fabCount.textContent = String(count);
    fabCount.classList.toggle('d-none', count === 0);
  }

  const cart = getCart();
  const empty = document.getElementById('shopCartEmpty');
  const list  = document.getElementById('shopCartList');
  const foot  = document.getElementById('shopCartFooter');
  if (!list || !empty || !foot) return;

  if (cart.length === 0) {
    empty.classList.remove('d-none');
    list.classList.add('d-none');
    foot.classList.add('d-none');
    list.innerHTML = '';
    return;
  }

  empty.classList.add('d-none');
  list.classList.remove('d-none');
  foot.classList.remove('d-none');

  list.innerHTML = cart.map((it, idx) => {
    const p = productMap[it.productId];
    const name = p?.name || it.productId;
    const colors = Array.isArray(p?.colors) ? p.colors : [];
    const colorLabel = colors.find((c) => c.id === it.color)?.label || it.color || '';
    const thumb = thumbStyle(p);
    const variantParts = [];
    if (it.size && it.size !== 'F') variantParts.push(`ไซส์ ${it.size}`);
    if (colors.length > 1 && colorLabel) variantParts.push(colorLabel);
    if (variantParts.length === 0) variantParts.push('Unisex');

    return `
      <div class="cart-item">
        <div class="cart-item-thumb" style="${thumb}"></div>
        <div>
          <div class="cart-item-name">${escHtml(name)}</div>
          <div class="cart-item-variant">${escHtml(variantParts.join(' · '))}</div>
          <div class="cart-item-actions">
            <div class="cart-qty-mini">
              <button type="button" data-cart-qty="-1" data-idx="${idx}">−</button>
              <span>${it.qty}</span>
              <button type="button" data-cart-qty="+1" data-idx="${idx}">+</button>
            </div>
            <button type="button" class="cart-item-remove" data-cart-remove="${idx}">
              <i class="bi bi-trash3"></i> ลบ
            </button>
          </div>
        </div>
        <div class="cart-item-price">฿${thb(it.price * it.qty)}</div>
      </div>`;
  }).join('');

  list.onclick = (e) => {
    const qtyBtn = e.target.closest('[data-cart-qty]');
    const rmBtn  = e.target.closest('[data-cart-remove]');
    if (qtyBtn) {
      const idx = Number(qtyBtn.dataset.idx);
      const delta = qtyBtn.dataset.cartQty === '+1' ? 1 : -1;
      const cur = getCart()[idx];
      if (cur) updateQty(idx, cur.qty + delta);
    } else if (rmBtn) {
      removeItem(Number(rmBtn.dataset.cartRemove));
    }
  };

  const subtotal = cartSubtotal();
  const sub = document.getElementById('shopCartSubtotalLabel');
  const gr  = document.getElementById('shopCartGrandLabel');
  if (sub) sub.textContent = `฿${thb(subtotal)}`;
  if (gr)  gr.textContent  = `฿${thb(subtotal)}`;
}

function thumbStyle(p) {
  if (p?.image_url) {
    return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

/**
 * Convenience accessor for other modules that need the products map
 * (e.g. orders renderer uses it for product names).
 */
export async function ensureProductsLoaded() {
  if (Object.keys(productMap).length > 0) return productMap;
  try {
    const list = await listProducts({ activeOnly: false });
    setShopCartProducts(list);
  } catch (e) {
    console.warn('[shop/cart] ensureProductsLoaded failed:', e);
  }
  return productMap;
}

export function getProductMap() { return productMap; }
