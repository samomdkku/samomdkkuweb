// ==============================================
// SHOP PRODUCTS — Browse grid, filter bar, launch carousel, detail modal
//
// All user-text fields (name, sub, desc, color label) are escaped before
// going into innerHTML — same XSS-class rule as the PR / VS renderers
// (see .claude/rules/mistakes.md).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { convertDriveUrl } from '../uploads.js';
import {
  SHOP_SOURCES, SHOP_SORT,
  findSource, thb, fmtDate, batchDateEntries,
  STOCK_STATUS_META, stockKey, totalStock,
  effectivePrice, isUnlimitedBuying,
  availableForVariant, availableTotal,
  getShopTypes, findPickupLocation,
} from './data.js';
import { listProducts, listActiveBatches, listShopBanners, fetchReservedMatrixAll, getSettings } from './api.js';
import { addItem } from './state.js';

let cache = { products: [], batches: [], contact: { instagram: '', gmail: '' }, loaded: false };

const filters = { source: 'all', type: 'all', sort: 'newest', search: '' };

// Storefront type-filter icons (line drawings from the shop redesign).
// Bootstrap Icons has no shirt / polo / trousers glyph, so these are
// inline SVGs keyed by SHOP_TYPES id. Admin keeps using SHOP_TYPES[].icon;
// a type without an entry here falls back to that bi-* class.
const TYPE_SVG_PATHS = {
  'all':             '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'apparel-shirt':   '<path d="M8 3 4 7l3 3v11h10V10l3-3-4-4-4 2-4-2Z"/>',
  // Polo: short sleeves + pointed collar flaps + button placket.
  'apparel-polo':    '<path d="M9 3 4.5 5.5 3.3 9.6 7 10.6V21h10V10.6l3.7-1-1.2-4.1L15 3"/><path d="M9 3l1.5 4.2L12 5.6l1.5 1.6L15 3"/><path d="M12 5.6V11.5"/><circle cx="12" cy="8.2" r=".55" fill="currentColor" stroke="none"/><circle cx="12" cy="10.4" r=".55" fill="currentColor" stroke="none"/>',
  // Trousers: waistband + fly, two legs split at the crotch.
  'apparel-trouser': '<path d="M6 3h12l1.2 18h-5L12 10.5 9.8 21h-5Z"/><path d="M6 6h12"/><path d="M12 6v3"/>',
  'bag':             '<path d="M4 9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 9V6a4 4 0 1 1 8 0v3"/>',
  'stationery':      '<path d="m17 3 4 4L9 19l-5 1 1-5Z"/>',
};
function typeIconHtml(t) {
  const paths = TYPE_SVG_PATHS[t.id];
  if (!paths) return `<i class="bi ${escHtml(t.icon || 'bi-tag')}"></i>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// Listeners to switch the parent view to "orders" (set up by index.js).
let onGoOrders = () => {};
export function setShopNavigators({ goOrders }) { onGoOrders = goOrders || onGoOrders; }

// ---------------------------------------------------------------------
// Mount: populate filter chips, attach search/sort handlers
// ---------------------------------------------------------------------
export function mountShopBrowse() {
  const sourceHost = document.getElementById('shopSourceChips');
  const typeHost   = document.getElementById('shopTypeChips');
  const sortSel    = document.getElementById('shopSortSelect');
  const search     = document.getElementById('shopSearchInput');

  if (sourceHost) {
    sourceHost.innerHTML = SHOP_SOURCES.map((s) => {
      const on = s.id === filters.source;
      return `<button type="button" class="sf-source-pill ${on ? 'is-active' : ''}" aria-pressed="${on}"
                data-src="${s.id}" data-source-id="${s.id}">
        <span class="sf-dot"></span>${escHtml(s.label)}
      </button>`;
    }).join('');
    sourceHost.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-source-id]');
      if (!btn) return;
      filters.source = btn.dataset.sourceId;
      sourceHost.querySelectorAll('[data-source-id]').forEach((el) => {
        const on = el.dataset.sourceId === filters.source;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', String(on));
      });
      renderGrid();
    });
  }
  if (typeHost) {
    // Chips come from the admin-managed type list (migration 0057). This
    // runs at mount with the built-in fallback, then reloadShop() re-renders
    // once the DB list is loaded. The delegated click handler survives the
    // innerHTML replacement (matches on [data-type-id]).
    renderTypeChips();
    typeHost.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-type-id]');
      if (!btn) return;
      filters.type = btn.dataset.typeId;
      typeHost.querySelectorAll('[data-type-id]').forEach((el) => {
        const on = el.dataset.typeId === filters.type;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', String(on));
      });
      renderGrid();
    });
  }
  if (sortSel) {
    sortSel.innerHTML = SHOP_SORT.map((s) =>
      `<option value="${s.id}">${escHtml(s.label)}</option>`).join('');
    sortSel.value = filters.sort;
    sortSel.addEventListener('change', () => { filters.sort = sortSel.value; renderGrid(); });
  }
  if (search) {
    search.addEventListener('input', () => {
      filters.search = search.value;
      renderGrid();
    });
  }

  // Click-through on grid + launch carousel → open detail modal.
  const grid = document.getElementById('shopProductGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (!product) return;
      e.preventDefault();
      openProductModal(product);
    });
  }
  const carousel = document.getElementById('shopLaunchCarousel');
  if (carousel) {
    carousel.addEventListener('click', (e) => {
      // Banner slide with link_url → open it (new tab if external).
      if (handleBannerLinkClick(e)) return;
      // Product card → open detail modal.
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (product) openProductModal(product);
    });
  }
  // ประกาศ carousel: link-only banners (no product fallback cards).
  document.getElementById('shopAnnounceCarousel')
    ?.addEventListener('click', handleBannerLinkClick);

  wireCarouselArrows(LAUNCH_CAROUSEL);
  wireCarouselArrows(ANNOUNCE_CAROUSEL);
}

/** (Re)render the ประเภท filter chips from the current type list. If the
 *  currently-selected type was removed by an admin, fall back to 'all' so
 *  the grid doesn't filter on a now-gone type. */
function renderTypeChips() {
  const typeHost = document.getElementById('shopTypeChips');
  if (!typeHost) return;
  const types = getShopTypes();
  if (filters.type !== 'all' && !types.some((t) => t.id === filters.type)) {
    filters.type = 'all';
  }
  typeHost.innerHTML = types.map((t) => {
    const on = t.id === filters.type;
    return `<button type="button" class="sf-icon-tab ${on ? 'is-active' : ''}" aria-pressed="${on}" data-type-id="${escHtml(t.id)}">
      <span class="sf-icon-circle">${typeIconHtml(t)}</span>
      <span class="sf-icon-label">${escHtml(t.label)}</span>
    </button>`;
  }).join('');
}

/** Open a banner slide's link_url (new tab if external). Returns true
 *  when a banner link was handled so callers can stop further handling. */
function handleBannerLinkClick(e) {
  const banner = e.target.closest('[data-banner-link]');
  if (!banner) return false;
  const href = banner.dataset.bannerLink;
  if (/^https?:\/\//i.test(href)) {
    window.open(href, '_blank', 'noopener');
  } else {
    location.href = href;
  }
  return true;
}

// ---------------------------------------------------------------------
// Reload from server, then render
// ---------------------------------------------------------------------
export async function reloadShop() {
  try {
    const [products, batches, banners, reservedAll, settings] = await Promise.all([
      listProducts({ activeOnly: true }),
      listActiveBatches().catch(() => []),
      listShopBanners().catch(() => []),
      fetchReservedMatrixAll().catch(() => ({})),
      getSettings().catch(() => null),
    ]);
    // Splice the reserved-qty matrix onto each product so downstream
    // renderers can compute available = max(0, stock - reserved)
    // without touching the cache shape further. Reserved entries
    // missing for a product are treated as 0 across all variants.
    cache.products = (products || []).map((p) => ({
      ...p,
      reserved_matrix: reservedAll[p.id] || {},
    }));
    cache.batches = batches || [];
    // Partition admin banners by placement (migration 0037). Rows with
    // no placement (pre-0037) default to the launch hero.
    const allBanners = banners || [];
    cache.banners = allBanners;
    cache.launchBanners   = allBanners.filter((b) => (b.placement || 'launch') === 'launch');
    cache.announceBanners = allBanners.filter((b) => b.placement === 'announcement');
    cache.contact = {
      instagram: settings?.contact_instagram || '',
      gmail: settings?.contact_gmail || '',
    };
    cache.loaded = true;
    // Re-render the type chips now that the admin-managed list is loaded
    // (index.js loads it just before this call).
    renderTypeChips();
    renderContactBanner();
    renderAnnounceBanners();
    renderBanner();
    renderLaunches();
    renderGrid();
  } catch (e) {
    console.error('[shop/products] reload failed:', e);
    cache.loaded = true;
    const grid = document.getElementById('shopProductGrid');
    if (grid) {
      grid.innerHTML = `<div class="text-danger small p-3">โหลดสินค้าล้มเหลว: ${escHtml(e.message || e)}</div>`;
    }
  }
}

// ---------------------------------------------------------------------
// Render: "if there's a problem, contact us" banner (top of shop view)
// ---------------------------------------------------------------------
function renderContactBanner() {
  const host = document.getElementById('shopContactBanner');
  if (!host) return;
  const ig = (cache.contact.instagram || '').replace(/^@/, '');
  if (!ig) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="shop-contact-strip">
      <i class="bi bi-info-circle"></i>
      <span>หากมีปัญหาในการสั่งซื้อ ติดต่อได้ที่</span>
      <a href="${safeUrl('https://instagram.com/' + ig)}" target="_blank" rel="noreferrer">
        <i class="bi bi-instagram"></i> IG: @${escHtml(ig)}
      </a>
    </div>`;
}

// ---------------------------------------------------------------------
// Render: pickup announcements (multiple cards)
// ---------------------------------------------------------------------
function renderBanner() {
  const host = document.getElementById('shopPickupBanner');
  if (!host) return;
  const list = cache.batches;
  host.classList.toggle('d-none', !list.length);
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="pickup-stack">
      ${list.map(pickupBannerCardHtml).join('')}
    </div>`;
  host.querySelectorAll('[data-pickup-go-orders]').forEach((btn) =>
    btn.addEventListener('click', () => onGoOrders()));
}

function pickupBannerCardHtml(b) {
  const entries = batchDateEntries(b);
  return `
    <div class="sf-announce">
      <div class="sf-announce-art" aria-hidden="true"><div class="sf-announce-mark">samo</div></div>
      <div class="sf-announce-body">
        <div class="sf-announce-main">
          <div class="sf-announce-tag">ประกาศรับสินค้า</div>
          <h3 class="sf-announce-title">${escHtml(b.title)}</h3>
          ${b.location ? `<div class="sf-announce-loc">รับได้ที่: ${escHtml(b.location)}</div>` : ''}
        </div>
        ${entries.length ? `
          <div class="sf-date-row">
            ${entries.map((e) => `
              <div class="sf-date-tile">
                <div class="sf-date-day">${escHtml(e.date)}</div>
                ${e.hours ? `<div class="sf-date-time">${escHtml(e.hours)}</div>` : ''}
              </div>`).join('')}
          </div>` : ''}
        <div class="sf-announce-side">
          ${b.note ? `<div class="sf-announce-note">${escHtml(b.note)}</div>` : '<div></div>'}
          <button type="button" class="sf-btn-primary" data-pickup-go-orders>
            ดูคำสั่งซื้อของฉัน <i class="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Render: launch carousel (latest is_new products, scrollable, with arrows)
// ---------------------------------------------------------------------
function renderLaunches() {
  const host = document.getElementById('shopLaunchCarousel');
  const dots = document.getElementById('shopLaunchDots');
  if (!host) return;

  // Priority 1: admin-curated banners. Priority 2 (fallback): the
  // newest `is_new` products. If we have no banners AND no flagged
  // products, fall back to the most-recently-added products so the
  // hero is never empty when there's stock to show.
  const banners = (cache.launchBanners || []).slice(0, 10);
  let slides;
  // Banner mode = full-width hero slides (one per view, with dots).
  // Product mode = several "drop" cards per view (no dots — arrows page
  // through by the visible width instead).
  const cardMode = banners.length === 0;
  host.classList.toggle('is-cards', cardMode);
  dots?.classList.toggle('d-none', cardMode);
  if (!cardMode) {
    slides = banners.map(bannerSlideHtml);
  } else {
    const flagged = cache.products.filter((p) => p.is_new).slice(0, 10);
    const fallback = flagged.length > 0
      ? flagged
      : cache.products.slice().sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0)).slice(0, 5);
    slides = fallback.map(dropCardHtml);
  }

  document.getElementById('shopDropsSection')?.classList.toggle('d-none', slides.length === 0);
  if (slides.length === 0) {
    host.innerHTML = '';
    if (dots) dots.innerHTML = '';
    setCarouselArrowsVisible(LAUNCH_CAROUSEL, false);
    return;
  }
  host.innerHTML = slides.join('');
  if (dots) {
    dots.innerHTML = slides.map((_, i) =>
      `<button type="button" class="launch-dot ${i === 0 ? 'is-active' : ''}" data-dot-i="${i}" aria-label="สไลด์ที่ ${i + 1}"></button>`
    ).join('');
  }
  setCarouselArrowsVisible(LAUNCH_CAROUSEL, slides.length > 1);
  // Arrow visibility for card mode depends on overflow, not count.
  if (cardMode) requestAnimationFrame(() =>
    setCarouselArrowsVisible(LAUNCH_CAROUSEL, host.scrollWidth > host.clientWidth + 2));
  updateCarouselArrowsState(LAUNCH_CAROUSEL);
  updateActiveDot(LAUNCH_CAROUSEL);
}

// ---------------------------------------------------------------------
// Render: ประกาศ swipe carousel — admin-curated banners with
// placement='announcement'. Same hero markup/CSS as เปิดตัวล่าสุด, but
// no product fallback: the whole section hides when there are none.
// ---------------------------------------------------------------------
function renderAnnounceBanners() {
  const host = document.getElementById('shopAnnounceCarousel');
  const dots = document.getElementById('shopAnnounceDots');
  const wrap = document.getElementById('shopAnnounceSection');
  if (!host) return;
  const banners = (cache.announceBanners || []).slice(0, 10);
  if (banners.length === 0) {
    host.innerHTML = '';
    if (dots) dots.innerHTML = '';
    setCarouselArrowsVisible(ANNOUNCE_CAROUSEL, false);
    wrap?.classList.add('d-none');
    return;
  }
  wrap?.classList.remove('d-none');
  host.innerHTML = banners.map(bannerSlideHtml).join('');
  if (dots) {
    dots.innerHTML = banners.map((_, i) =>
      `<button type="button" class="launch-dot ${i === 0 ? 'is-active' : ''}" data-dot-i="${i}" aria-label="สไลด์ที่ ${i + 1}"></button>`
    ).join('');
  }
  setCarouselArrowsVisible(ANNOUNCE_CAROUSEL, banners.length > 1);
  updateCarouselArrowsState(ANNOUNCE_CAROUSEL);
  updateActiveDot(ANNOUNCE_CAROUSEL);
}

function bannerSlideHtml(b) {
  const link = b.link_url ? `data-banner-link="${escHtml(b.link_url)}"` : '';
  return `
    <div class="launch-big" ${link}>
      <div class="launch-big-thumb">
        ${b.image_url
          ? `<img src="${safeUrl(convertDriveUrl(b.image_url))}" alt="${escHtml(b.caption || '')}" loading="lazy" />`
          : '<div class="stripe-placeholder"></div>'}
      </div>
      ${b.caption ? `
        <div class="launch-big-body">
          <div class="lb-name">${escHtml(b.caption)}</div>
        </div>` : ''}
    </div>`;
}

/** "Latest Drops" card — used when there are no admin launch banners
 *  and the carousel falls back to is_new / newest products. */
function dropCardHtml(p) {
  const src = findSource(p.source);
  const oos = p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
  return `
    <div class="sf-drop-card ${oos ? 'is-oos' : ''}" data-product-id="${escHtml(p.id)}">
      <div class="sf-drop-thumb">
        ${p.image_url
          ? `<img src="${safeUrl(convertDriveUrl(p.image_url))}" alt="${escHtml(p.name)}" loading="lazy" />`
          : `<div class="stripe-placeholder" style="background-image: repeating-linear-gradient(135deg, hsl(${Number(p.hue) || 220} 30% 96%) 0 6px, hsl(${Number(p.hue) || 220} 28% 90%) 6px 12px);"></div>`}
        <div class="ribbons">
          <span class="ribbon-new">NEW</span>
          ${p.is_presale ? '<span class="ribbon-preorder">PREORDER</span>' : ''}
          ${p.stock_status && p.stock_status !== 'available' ? `<span class="ribbon-oos">${escHtml(STOCK_STATUS_META[p.stock_status]?.ribbon || '')}</span>` : ''}
        </div>
      </div>
      <span class="product-source" data-src="${escHtml(p.source)}">
        <span class="src-dot"></span> ${escHtml(src?.label || p.source)}
      </span>
      <div class="sf-drop-name">${escHtml(p.name)}</div>
      ${p.sub ? `<div class="sf-drop-sub">${escHtml(p.sub)}</div>` : ''}
      <div class="sf-drop-foot">
        <span class="sf-drop-price">฿ ${thb(effectivePrice(p))}</span>
        <span class="sf-drop-date">${fmtDate(p.added_at)}</span>
      </div>
    </div>`;
}

// Two carousels share identical mechanics (one slide per view, snap,
// arrows, dots) and CSS — only their element ids differ. Each helper
// takes a scope object so the launch hero and the ประกาศ carousel run
// off the same code.
const LAUNCH_CAROUSEL = {
  carousel: 'shopLaunchCarousel', dots: 'shopLaunchDots',
  prev: 'shopLaunchPrev', next: 'shopLaunchNext',
};
const ANNOUNCE_CAROUSEL = {
  carousel: 'shopAnnounceCarousel', dots: 'shopAnnounceDots',
  prev: 'shopAnnouncePrev', next: 'shopAnnounceNext',
};

function wireCarouselArrows(c) {
  const prev = document.getElementById(c.prev);
  const next = document.getElementById(c.next);
  const car  = document.getElementById(c.carousel);
  const dots = document.getElementById(c.dots);
  if (!car) return;
  // Hero banner: one slide per view. Scroll by the carousel's exact
  // visible width so the snap lands cleanly on the next/prev card.
  const step = () => car.clientWidth || 1;
  prev?.addEventListener('click', () => car.scrollBy({ left: -step(), behavior: 'smooth' }));
  next?.addEventListener('click', () => car.scrollBy({ left:  step(), behavior: 'smooth' }));
  car.addEventListener('scroll', () => {
    updateCarouselArrowsState(c);
    updateActiveDot(c);
  }, { passive: true });
  window.addEventListener('resize', () => {
    updateCarouselArrowsState(c);
    updateActiveDot(c);
  }, { passive: true });
  // Dot click → scroll to that slide.
  dots?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dot-i]');
    if (!btn) return;
    const i = Number(btn.dataset.dotI) || 0;
    car.scrollTo({ left: i * step(), behavior: 'smooth' });
  });
}

function updateActiveDot(c) {
  const car  = document.getElementById(c.carousel);
  const dots = document.getElementById(c.dots);
  if (!car || !dots) return;
  const w = car.clientWidth || 1;
  const active = Math.round(car.scrollLeft / w);
  dots.querySelectorAll('.launch-dot').forEach((d, i) =>
    d.classList.toggle('is-active', i === active));
}

function setCarouselArrowsVisible(c, show) {
  document.getElementById(c.prev)?.classList.toggle('d-none', !show);
  document.getElementById(c.next)?.classList.toggle('d-none', !show);
}

function updateCarouselArrowsState(c) {
  const car  = document.getElementById(c.carousel);
  const prev = document.getElementById(c.prev);
  const next = document.getElementById(c.next);
  if (!car || !prev || !next) return;
  prev.disabled = car.scrollLeft <= 2;
  next.disabled = car.scrollLeft + car.clientWidth >= car.scrollWidth - 2;
}

// ---------------------------------------------------------------------
// Render: filtered product grid
// ---------------------------------------------------------------------
function renderGrid() {
  const grid = document.getElementById('shopProductGrid');
  const empty = document.getElementById('shopProductEmpty');
  const count = document.getElementById('shopResultCount');
  if (!grid) return;

  let list = cache.products.slice();
  if (filters.source !== 'all') list = list.filter((p) => p.source === filters.source);
  if (filters.type   !== 'all') list = list.filter((p) => p.type === filters.type);
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter((p) =>
      (p.name || '').toLowerCase().includes(q) || (p.sub || '').toLowerCase().includes(q));
  }
  switch (filters.sort) {
    case 'price-asc':  list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'popular':    list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)); break;
    default:           list.sort((a, b) =>
      new Date(b.added_at || 0) - new Date(a.added_at || 0));
  }
  if (count) count.textContent = String(list.length);
  if (empty) empty.classList.toggle('d-none', list.length > 0);
  grid.innerHTML = list.map(productCardHtml).join('');
}

function productCardHtml(p) {
  const src = findSource(p.source);
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const colors = Array.isArray(p.colors) ? p.colors : [];
  const oos = p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
  // Per-product quantity ("เหลือ N ชิ้น") is deliberately NOT shown on the
  // main grid — the count belongs on the product detail, per subtype.
  // We keep only a non-numeric "หมดแล้ว" badge when nothing is buyable so
  // shoppers aren't sent into a dead-end product. The numeric per-variant
  // count still renders inside the product modal (renderVariantStockBadge).
  const total = (oos || isUnlimitedBuying(p)) ? null : availableTotal(p);
  const stockHint = total === 0
    ? '<span class="product-stock-hint is-out">หมดแล้ว</span>'
    : '';
  return `
    <div class="product-card ${oos ? 'is-oos' : ''}" data-product-id="${escHtml(p.id)}">
      <div class="product-thumb">
        ${p.image_url
          ? `<img class="product-thumb-img" src="${safeUrl(convertDriveUrl(p.image_url))}" alt="${escHtml(p.name)}" loading="lazy" />`
          : `<div class="stripe-placeholder"><span>PRODUCT · ${escHtml(p.id)}</span></div>`}
        <div class="ribbons">
          ${p.is_new ? '<span class="ribbon-new">NEW</span>' : ''}
          ${p.is_presale ? '<span class="ribbon-preorder">PREORDER</span>' : ''}
          ${oos ? `<span class="ribbon-oos">${escHtml(STOCK_STATUS_META[p.stock_status]?.ribbon || '')}</span>` : ''}
        </div>
      </div>
      <div class="product-body">
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(src?.label || p.source)}
        </span>
        <div class="product-name">${escHtml(p.name)}</div>
        <div class="product-meta">
          <span>${escHtml(p.sub || '')}</span>
          ${sizes.length > 1 ? `<span class="dot"></span><span>${sizes.length} ไซส์</span>` : ''}
          ${colors.length > 1 ? `<span class="dot"></span><span>${colors.length} สี</span>` : ''}
        </div>
        <div class="product-foot">
          <span class="product-price">
            <span class="baht">฿</span>${thb(effectivePrice(p))}
          </span>
          ${stockHint}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Product detail modal — Bootstrap modal in modal-shop-product.html
// ---------------------------------------------------------------------
const modalState = { product: null, size: 'F', color: null, qty: 1 };

function openProductModal(product) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : ['F'];
  const colors = Array.isArray(product.colors) ? product.colors : [];
  modalState.product = product;
  // Default to the first variant the buyer can actually buy right now
  // — admin's stock minus active reservations. If the matrix isn't
  // configured we let the buyer pick anything (untracked stock).
  const matrix = product.stock_matrix || {};
  const configured = Object.values(matrix).some((v) => typeof v === 'number');
  let pickedSize = sizes[0] || 'F';
  let pickedColor = colors[0]?.id || null;
  if (configured && !isUnlimitedBuying(product)) {
    outer: for (const s of sizes) {
      for (const c of (colors.length ? colors : [{ id: 'default' }])) {
        const avail = availableForVariant(product, s, c.id);
        if (avail != null && avail > 0) { pickedSize = s; pickedColor = c.id; break outer; }
      }
    }
  }
  modalState.size = pickedSize;
  modalState.color = pickedColor;
  modalState.qty = 1;

  // Header
  const header = document.getElementById('shopProductModalHeader');
  if (header) {
    const src = findSource(product.source);
    header.innerHTML = `
      <span class="product-source" data-src="${escHtml(product.source)}">
        <span class="src-dot"></span> ${escHtml(src?.label || product.source)}
      </span>
      <h5 class="modal-title font-prompt mt-1" id="shopProductModalTitle" style="font-weight:700;">
        ${escHtml(product.name)}
      </h5>`;
  }
  // Hero
  const hero = document.getElementById('shopProductModalHero');
  if (hero) {
    hero.innerHTML = '';
    hero.style.backgroundImage = '';
    if (product.image_url) {
      hero.style.backgroundImage = `url('${safeUrl(product.image_url)}')`;
    } else {
      const h = Number(product.hue) || 220;
      hero.style.background = `repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 6px, hsl(${h} 28% 90%) 6px 12px)`;
    }
  }
  setText('shopProductModalSub',   product.sub || '');
  setText('shopProductModalPrice', thb(effectivePrice(product)));
  setText('shopProductModalDesc',  product.description || '');

  // Preorder (was "Presale") note
  const preorderBox  = document.getElementById('shopProductModalPreorder');
  const preorderNote = document.getElementById('shopProductModalPreorderNote');
  if (preorderBox && preorderNote) {
    preorderBox.classList.toggle('d-none', !product.is_presale);
    preorderNote.textContent = product.presale_note || '';
  }

  // Pickup location (migration 0057) — shown so the buyer knows where
  // they'll collect this item. Hidden when the product has none assigned.
  const pickupBox = document.getElementById('shopProductModalPickup');
  if (pickupBox) {
    const loc = findPickupLocation(product.pickup_location_id);
    pickupBox.classList.toggle('d-none', !loc);
    if (loc) {
      pickupBox.innerHTML = `<i class="bi bi-geo-alt me-1"></i>รับสินค้าที่: <b>${escHtml(loc.label)}</b>`
        + (loc.detail ? `<span class="d-block text-muted mt-1" style="white-space:pre-wrap;">${escHtml(loc.detail)}</span>` : '');
    }
  }

  // Stock status banner (sold out / production closed)
  const statusBox = document.getElementById('shopProductModalStockStatus');
  if (statusBox) {
    const blocked = product.stock_status === 'sold_out' || product.stock_status === 'production_closed';
    statusBox.classList.toggle('d-none', !blocked);
    if (blocked) {
      const meta = STOCK_STATUS_META[product.stock_status];
      statusBox.innerHTML = `<i class="bi bi-exclamation-octagon me-1"></i> ${escHtml(meta?.label || '')}`;
    }
  }

  renderSizeOptions(sizes);
  renderColorOptions(colors);
  renderQty();
  renderOOS();

  const inst = window.bootstrap?.Modal.getOrCreateInstance(
    document.getElementById('shopProductModal'),
    { backdrop: true },
  );
  inst?.show();

  document.getElementById('shopProductModalQtyMinus')?.replaceWith(rebuildBtn('shopProductModalQtyMinus', '−', () => {
    modalState.qty = Math.max(1, modalState.qty - 1); renderQty();
  }));
  document.getElementById('shopProductModalQtyPlus')?.replaceWith(rebuildBtn('shopProductModalQtyPlus', '+', () => {
    // Cap at available qty for in-stock products so a buyer can't
    // request more than they can have. Preorder products keep the
    // legacy 99 ceiling (unlimited buying).
    const p = modalState.product;
    let ceiling = 99;
    if (p && !isUnlimitedBuying(p)) {
      const avail = availableForVariant(p, modalState.size, modalState.color);
      if (avail != null) ceiling = Math.max(1, avail);
    }
    modalState.qty = Math.min(ceiling, modalState.qty + 1); renderQty();
  }));

  const addBtn = document.getElementById('shopProductModalAdd');
  if (addBtn) {
    addBtn.onclick = () => {
      if (isBlockedForPurchase()) return;
      addItem({
        productId: product.id,
        size: modalState.size,
        color: modalState.color,
        fit: 'unisex',
        qty: modalState.qty,
        price: effectivePrice(product),
      });
      inst?.hide();
      showShopToast(`เพิ่ม "${product.name}" ลงตะกร้าแล้ว`, 'success');
    };
  }
}

/** Is this size entirely out across every color? Used to grey out the
 *  size button. "Entirely" = matrix configured AND every color cell for
 *  this size is either explicitly 0 or undefined. Preorder products
 *  never grey out — buyers can order any variant regardless of admin's
 *  internal numbers. */
function isSizeAllOOS(size) {
  const p = modalState.product;
  if (!p || isUnlimitedBuying(p) || !matrixIsConfigured(p)) return false;
  const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : [{ id: 'default' }];
  // OOS = every colour for this size has zero available (stock minus
  // reservations). An untracked cell (null) means "no configured stock"
  // and is treated as OOS only when at least one other cell IS tracked,
  // matching the existing matrixIsConfigured gate.
  return colors.every((c) => {
    const avail = availableForVariant(p, size, c.id);
    return avail == null || avail <= 0;
  });
}
function isColorAllOOS(color) {
  const p = modalState.product;
  if (!p || isUnlimitedBuying(p) || !matrixIsConfigured(p)) return false;
  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['F'];
  return sizes.every((s) => {
    const avail = availableForVariant(p, s, color);
    return avail == null || avail <= 0;
  });
}

function renderSizeOptions(sizes) {
  const group = document.getElementById('shopProductModalSizeGroup');
  const host  = document.getElementById('shopProductModalSizeOptions');
  if (!group || !host) return;
  group.classList.toggle('d-none', sizes.length <= 1);
  host.innerHTML = sizes.map((s) => {
    const oos = isSizeAllOOS(s);
    return `<button type="button"
             class="variant-btn ${modalState.size === s ? 'is-selected' : ''} ${oos ? 'is-oos' : ''}"
             ${oos ? 'disabled' : ''} data-size="${escHtml(s)}"
             title="${oos ? 'หมดทุกสี' : escHtml(s)}">
       ${escHtml(s)}${oos ? ' <span class="small text-muted">(หมด)</span>' : ''}
     </button>`;
  }).join('');
  host.onclick = (e) => {
    const btn = e.target.closest('[data-size]:not([disabled])');
    if (!btn) return;
    modalState.size = btn.dataset.size;
    host.querySelectorAll('.variant-btn').forEach((el) =>
      el.classList.toggle('is-selected', el.dataset.size === modalState.size));
    renderOOS();
  };
}
function renderColorOptions(colors) {
  const group = document.getElementById('shopProductModalColorGroup');
  const host  = document.getElementById('shopProductModalColorOptions');
  const label = document.getElementById('shopProductModalColorLabel');
  if (!group || !host) return;
  group.classList.toggle('d-none', colors.length <= 1);
  host.innerHTML = colors.map((c) => {
    const oos = isColorAllOOS(c.id);
    return `<button type="button"
             class="variant-swatch ${modalState.color === c.id ? 'is-selected' : ''} ${oos ? 'is-oos' : ''}"
             ${oos ? 'disabled' : ''}
             data-color="${escHtml(c.id)}" style="background: ${escHtml(c.hex || '#ccc')};"
             aria-label="${escHtml(c.label || c.id)}${oos ? ' (หมด)' : ''}"
             title="${escHtml(c.label || c.id)}${oos ? ' — หมด' : ''}">
     </button>`;
  }).join('');
  if (label) {
    const found = colors.find((c) => c.id === modalState.color);
    label.textContent = found?.label || '';
  }
  host.onclick = (e) => {
    const btn = e.target.closest('[data-color]:not([disabled])');
    if (!btn) return;
    modalState.color = btn.dataset.color;
    host.querySelectorAll('.variant-swatch').forEach((el) =>
      el.classList.toggle('is-selected', el.dataset.color === modalState.color));
    if (label) {
      const found = colors.find((c) => c.id === modalState.color);
      label.textContent = found?.label || '';
    }
    renderOOS();
  };
}
function renderQty() {
  const qty = document.getElementById('shopProductModalQty');
  if (qty) qty.value = String(modalState.qty);
  const addLabel = document.getElementById('shopProductModalAddLabel');
  const product = modalState.product;
  if (addLabel && product) {
    addLabel.textContent = `เพิ่มลงตะกร้า · ฿${thb(effectivePrice(product) * modalState.qty)}`;
  }
}
function renderOOS() {
  const box = document.getElementById('shopProductModalOOS');
  const addBtn = document.getElementById('shopProductModalAdd');
  const variantOOS = isVariantOOS();
  const blocked = isBlockedForPurchase();
  if (box) box.classList.toggle('d-none', !variantOOS || blocked);
  if (addBtn) addBtn.disabled = blocked || variantOOS;
  renderStockLeftHint();
}

/** Render a "เหลือ N ชิ้น" badge for the currently selected variant
 *  on the product modal. Hidden when the admin hasn't filled in the
 *  matrix value for this cell (undefined → display nothing). Stays
 *  hidden too when the product is globally blocked (sold_out / closed)
 *  because the OOS pill already covers that case. Preorder products
 *  don't show any number — the whole point of preorder is unlimited
 *  buying before admin commits to a production run. */
function renderStockLeftHint() {
  const host = document.getElementById('shopProductModalStockLeft');
  if (!host) return;
  const p = modalState.product;
  if (!p || isBlockedForPurchase() || isUnlimitedBuying(p)) {
    host.classList.add('d-none'); host.textContent = ''; return;
  }
  const left = availableForVariant(p, modalState.size, modalState.color);
  if (left == null) { host.classList.add('d-none'); host.textContent = ''; return; }
  host.classList.remove('d-none');
  if (left === 0) {
    host.textContent = 'หมดสต็อกแล้ว';
    host.className = 'small fw-semibold text-danger d-block mt-1';
  } else if (left <= 5) {
    host.textContent = `เหลือ ${left} ชิ้น`;
    host.className = 'small fw-semibold text-warning d-block mt-1';
  } else {
    host.textContent = `เหลือ ${left} ชิ้น`;
    host.className = 'small text-muted d-block mt-1';
  }
}
/** Has the admin set ANY value on this product's stock matrix?
 *  If yes, we treat undefined-key as "intentionally not stocked" → OOS.
 *  If no, the matrix is untracked and we fall back to "purchase allowed"
 *  (the global stock_status / production_status pills handle the broader
 *  block). */
function matrixIsConfigured(p) {
  const m = p?.stock_matrix || {};
  for (const v of Object.values(m)) {
    if (typeof v === 'number' && Number.isFinite(v)) return true;
  }
  return false;
}

function isVariantOOS() {
  const p = modalState.product;
  if (!p) return false;
  // Preorder products bypass stock entirely — no variant ever blocks
  // add-to-cart, no matter what the admin's internal numbers look like.
  if (isUnlimitedBuying(p)) return false;
  const avail = availableForVariant(p, modalState.size, modalState.color);
  if (avail != null) return avail <= 0;
  // Key missing — OOS only when the matrix is configured overall. An
  // empty matrix means "not tracked" and we don't block.
  return matrixIsConfigured(p);
}
function isBlockedForPurchase() {
  const p = modalState.product;
  if (!p) return true;
  return p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}
function rebuildBtn(id, label, onclick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.textContent = label;
  btn.onclick = onclick;
  return btn;
}

/**
 * Lightweight toast — Bootstrap toast container is already in index.html
 * for VS/PR forms; reuse it for the shop too. Falls back to a console log
 * if the host element isn't present (e.g. unit test).
 */
export function showShopToast(message, variant = 'success') {
  let host = document.getElementById('shopToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'shopToastHost';
    host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    host.style.zIndex = '1090';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast align-items-center text-bg-light border-0 show';
  el.setAttribute('role', 'status');
  el.style.borderLeft = `4px solid ${
    variant === 'success' ? 'var(--brand-accent)' :
    variant === 'warn'    ? 'var(--brand-orange)' :
    'var(--status-cancel, #91272b)'
  }`;
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body" style="font-size:.9rem">${escHtml(message)}</div>
      <button type="button" class="btn-close me-2 m-auto" aria-label="Close"></button>
    </div>`;
  host.appendChild(el);
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.btn-close').addEventListener('click', close);
  setTimeout(close, 3500);
}
