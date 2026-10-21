// ==============================================
// SHOP ADMIN — Preorder demand aggregation. Split out of admin.js
// (task 19 — maintainability).
// ==============================================

import { escHtml } from '../utils.js';
import { getShopTypes } from './data.js';
import { listAllOrders, listProducts } from './api.js';
import { showShopToast } from './products.js';
import { state, setOrders } from './admin.js';
import { openOrderModal, itemVariantLabel } from './admin-orders.js';

// ---------------------------------------------------------------------
// Preorder demand — per-product / per-subtype counts of preorder items,
// each expandable to the orders that contain it. Pure client-side
// aggregation over the already-loaded orders (is_preorder is the frozen
// per-item snapshot from place_shop_order).
// ---------------------------------------------------------------------
export async function refreshPreorder() {
  try {
    const [orders, products] = await Promise.all([
      listAllOrders(),
      (state.products && state.products.length)
        ? Promise.resolve(state.products)
        : listProducts({ activeOnly: false }).catch(() => []),
    ]);
    setOrders(orders);
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

export function renderPreorder() {
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

