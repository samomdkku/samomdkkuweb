// ==============================================
// SHOP ADMIN — Drive-image cleanup shared by Batches / Products / Banners.
// Split out of admin.js (task 19 — maintainability).
// ==============================================

import { dbRest } from '../db.js';
import { listProducts, listAllBatches } from './api.js';
import { productImages, imageBase } from './data.js';
import { deleteShopFile } from './uploads.js';

/** Trash a Drive image a deleted row pointed at — AFTER the delete, and only
 *  when no product, pickup announcement or banner still shows it (a shop
 *  admin reads every such row, so these lists are complete for this caller).
 *  Deleting a product or banner used to leave its picture public in Drive. */
export async function trashImageIfUnused(url) {
  const u = String(url || '').trim();
  if (!u) return;
  // Asked of the SERVER, not state.*: state.batches is only filled once the
  // ประกาศรับสินค้า tab has been opened, so a product deleted from the products
  // tab could trash a picture an announcement still shows. If this read fails,
  // keep the file — a leftover image is recoverable, a deleted one is not.
  let rows;
  try {
    // Banners read directly: listShopBanners answers [] on an error (a
    // pre-0019 fallback), and [] here would mean "unused" — fail OPEN.
    const bannerRead = dbRest('/shop_banners?select=image_url').then(({ data, error }) => {
      if (error || !Array.isArray(data)) throw new Error(error?.message || 'banners unreadable');
      return data;
    });
    const [products, batches, banners] = await Promise.all([
      listProducts({ activeOnly: false }), listAllBatches(), bannerRead,
    ]);
    // EVERY picture of every product (0203), not just its cover — or saving
    // product A would trash picture 2 of product B. Compared by lh3 base, since
    // a cover carries =w1200 and images[] does not.
    rows = [
      ...products.flatMap((p) => productImages(p).map((x) => x.url)),
      ...batches.map((b) => b.image_url), ...banners.map((b) => b.image_url),
    ].filter(Boolean).map(imageBase);
  } catch (e) {
    console.warn('[shop/admin] image kept — could not confirm it is unused:', e?.message || e);
    return;
  }
  if (!rows.includes(imageBase(u))) deleteShopFile(u).catch(() => {});
}
