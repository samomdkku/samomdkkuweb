# SAMO Shop — product gallery, zoom, and colour-linked pictures

**DESIGN ONLY — nothing here is built yet.** Written 2026-09-22 from the owner's
request:

1. an admin can upload **more than one picture** per product;
2. **กดที่รูปแล้วรูปใหญ่ขึ้น ซูมได้** — tap a picture to see it big and zoom it;
3. **กดเปลี่ยนสีแล้วรูปเปลี่ยนตาม** — picking a colour shows that colour's
   picture. The owner said this one is optional ("บวกลบแล้วแต่").

The build order is §9. What an owner must still decide is §10: three questions,
each with a default, so the build does not wait on them.

---

## 0. What exists today (measured 2026-09-22, not assumed)

| Fact | Where / how it was checked |
|---|---|
| One picture per product: `shop_products.image_url text` | `0003_samoshop_schema.sql:51` |
| The live catalogue has **1** product, with 1 picture | `select count(*) from shop_products` |
| The stored picture is **≤ 1200 px**: `=w1200`, `=w2400` and `=s0` return the same 530 KB | `curl` of the live lh3 URL at each size |
| lh3 serves any width from one URL (`…=w200`, `…=w1200`, `…=s0`) | same `curl` — `=w200` is 52 KB |
| Pictures upload through the Apps Script `uploadShopFile`, on SAVE, held in memory at pick (`read-file.js`), shrunk to `maxEdge` 2000 | `src/js/shop/admin.js` saveProductForm |
| The product popup's picture is a `background-image` on a `<div>` | `modal-shop-product.html:15`, `products.js` openProductModal |
| Colours are `colors jsonb` = `[{id, label, hex}]`; a cart line and an order item carry `color` = that `id` | `0003`, `cart.js`, `place_shop_order` |
| No lightbox exists in the repo; `Sortable` is already loaded on `/admin/` (CDN) | `grep`, `admin/index.html:316` |
| Every reader of the product picture is in `src/js/shop/` (none in the notify server or Apps Script) | `grep -rn image_url server/ appscript/` → 0 |

The 1200 px ceiling matters for request 2: **zoom can only show pixels that
were stored.** The current photo zooms to nothing new. Pictures uploaded after
this ships are stored larger (§5).

---

## 1. What good shops do — and what we copy

The pattern is the same across Uniqlo, Shopify's default themes, Amazon and
Lazada/Shopee, so it is not a matter of taste:

- **A main picture and a row of small pictures under it**; swipe on a phone,
  thumbnails or arrows on a desktop. The first picture is the one on the card.
- **Tap a picture to open it full-screen**; pinch or double-tap to zoom, drag to
  pan, swipe to the next, swipe down or ✕ to close. Close also works with the
  phone's **back** button, which is what people press.
- **Picking a colour JUMPS to that colour's first picture. It does not hide
  the other pictures.** The untagged ones (size chart, model shot, detail) stay
  in the row.
- **Swiping to a picture does NOT change the selected colour.** A buyer who is
  just browsing pictures should not end up ordering a colour they never tapped.
  Shopify themes argue about this; we choose the version that cannot cause a
  wrong order.

What we deliberately do NOT copy: hover-zoom lenses (useless on phones, where
our buyers are), 360° spins and video. These are out of scope (§11).

---

## 2. Data model — one column, one writer

### Decision: `shop_products.images jsonb` (an ordered array), NOT a separate table

```jsonc
// shop_products.images — order = display order; [0] is the cover
[
  { "url": "https://lh3.googleusercontent.com/d/<id>", "w": 2400, "h": 3000, "color": null },
  { "url": "https://lh3.googleusercontent.com/d/<id>", "w": 2400, "h": 3000, "color": "black" },
  { "url": "https://lh3.googleusercontent.com/d/<id>", "w": 2400, "h": 3000, "color": "navyblue" }
]
```

Why not a `shop_product_images` table (the textbook shape)?

- **The product is saved in ONE write** (`upsertProduct`, merge-duplicates). A
  second table makes a product save two writes that can half-succeed. It also
  needs its own RLS policies, grants and ordering column. And both repos are
  public, so every new table is another thing to get exactly right (mistakes
  class 6, "0188 was born anon-writable").
- The shop already stores `colors`, `sizes`, `stock_matrix` and
  `price_by_size` the same way on the product row. Readers get the pictures
  with the product, in the same request, which saves a query and a join on
  every page.
- What a table would buy (querying across all pictures, per-picture RLS) is
  not needed: a product has at most a handful of pictures, and they share the
  product's visibility.

Fields:

- `url`: stored **without** the `=w…` suffix; readers ask for a size (§5).
- `w` / `h`: the stored master's size. The lightbox needs it to animate
  without a jump.
- `color`: a `colors[].id` or `null` (a picture for every colour).

There is no per-picture caption or alt text field: alt is generated (§7), so
there is no field for an admin to leave empty.

### `image_url` stays, as the COVER, derived — never written separately again

About 12 readers use `image_url`: cards, cart, checkout, orders, announcement
fallbacks, admin tables and Discord. Moving them all in one release is
avoidable risk. So `image_url` stays, **written by a trigger, not by the
client**. A second writable copy of one fact is how this repo's worst drift
happened (mistakes class 6, `students`/`team_members`).

```sql
-- sketch for migration 0203 (to be written against the LIVE schema)
alter table public.shop_products add column images jsonb not null default '[]';

-- Backfill: every product with a picture gets a one-picture gallery.
update public.shop_products
   set images = jsonb_build_array(jsonb_build_object(
         'url', regexp_replace(image_url, '=[a-z0-9-]+$', ''), 'w', null, 'h', null, 'color', null))
 where image_url is not null and images = '[]';

-- The cover follows the gallery. The one writer of image_url from now on.
create function public.shop_products_cover() returns trigger ... as $$
begin
  if new.images is distinct from coalesce(old.images, '[]') or tg_op = 'INSERT' then
    new.image_url := case when jsonb_array_length(new.images) > 0
                          then (new.images -> 0 ->> 'url') || '=w1200' end;
  elsif new.image_url is distinct from old.image_url then
    -- An OLD client (a tab opened before the deploy) wrote image_url only:
    -- replace the COVER, keep the rest of the gallery. Never shrink it to one.
    new.images := case when new.image_url is null then new.images - 0
      else jsonb_set(coalesce(nullif(new.images, '[]'), '[{}]'), '{0}',
             jsonb_build_object('url', regexp_replace(new.image_url, '=[a-z0-9-]+$', ''),
                                'w', null, 'h', null, 'color', null)) end;
  end if;
  return new;
end $$;
```

- The two branches are exclusive, so the trigger cannot loop (class 6: the
  termination condition).
- The `elsif` exists only for stale tabs. A proof must cover it, because it is
  the branch nobody will click on purpose.

### Constraints — refused by the database, not just the form

`check (public.shop_images_ok(images))`:

- it is an array of **at most 8** entries (§10 Q1);
- each entry is an object with exactly the keys `url`, `w`, `h`, `color`;
- `url` is Google-hosted: reuse `shop_slip_url_ok` (0202), renamed
  `shop_drive_url_ok` with the old name kept as a wrapper;
- `w`/`h` are null or positive integers;
- `color` is null or a string.

Whether `color` names a colour that still exists is **not** enforced in the
database. Deleting a colour must not fail a save; an orphan tag is treated as
`null` (§4).

---

## 3. Admin — the product editor

Replace the single "อัปโหลดรูป" button with a **picture strip**:

```
รูปสินค้า (ลากเพื่อเรียง · รูปแรก = รูปปก)                 3 / 8
┌──────┐ ┌──────┐ ┌──────┐ ┌ ─ ─ ─ ┐
│ ปก   │ │      │ │      │ │   +   │   ← picks several at once (multiple)
│ [img]│ │ [img]│ │ [img]│ │ เพิ่มรูป │
│สี:ทุกสี▾│ │สี:ดำ ▾│ │สี:กรม▾│ └ ─ ─ ─ ┘
│  ✕   │ │  ✕   │ │  ✕   │
└──────┘ └──────┘ └──────┘
```

- **Drag to reorder** (Sortable, already on the page); the first picture is the
  cover, with a "ปก" badge. Also add ◀ ▶ buttons, because a drag is not
  reachable by keyboard or on some phones (mistakes class 4: every input path).
- **The colour dropdown per picture** lists `ทุกสี` plus the product's current
  colours. It re-renders when a colour row is added, renamed or removed, and a
  removed colour's pictures fall back to `ทุกสี` with a visible note.
- **✕ removes a picture from the strip only.** Nothing leaves Drive until SAVE.
- **The repo rules hold, unchanged.** Pictures are copied into memory at pick
  (`holdAllInMemory`) and shrunk at pick. They are uploaded on SAVE, never on
  pick (`upload-on-save-not-on-pick`).
- **Save, in order:**
  1. Upload the new pictures one at a time. Pace them; the Apps Script shows
     Google's busy page under a burst.
  2. Write the product **once**, with the final `images` array.
  3. **Only after that write succeeds**, trash the pictures that were removed.
     Each goes only if no product (**any entry of any `images` array**),
     announcement or banner still uses it: `trashImageIfUnused`, which reads
     the server.
  4. If the write fails, trash **this attempt's uploads**, as the product save
     already does today (`uploadedNow`).
- **Progress:** "กำลังอัปโหลดรูป 2/3…" on the save button, like the PR form.

⚠️ **A reader of the new column that must not be missed:** the in-use check.
Today it compares `image_url`. After this change it must look inside every
`images` array, or it will trash picture 2 of product A because product B's
cover is different. See the reader registry in §8.

---

## 4. Storefront — the gallery in the product popup

Replace the `background-image` `<div>` with real `<img>` elements. An `<img>`
is what the lightbox opens, what a screen reader announces, and what `srcset`
can size.

- **Main area: a horizontal scroll-snap track**
  (`scroll-snap-type: x mandatory`). Swiping is the browser's own touch
  scrolling, with no gesture code of ours, so none of the `pointercancel` bugs
  this repo has paid for. The ribbons (NEW / PREORDER / หมด) stay overlaid.
- **Thumbnails** under it; **dots** instead on a narrow phone; ◀ ▶ on desktop;
  ← → keys when focused. An `IntersectionObserver` on the track keeps the
  active thumbnail in sync with the swipe.
- **Colour link (request 3):** selecting a colour scrolls the track to that
  colour's **first** tagged picture.
  - If the colour has no tagged picture, nothing moves, rather than jumping to
    the cover and losing the buyer's place.
  - Pictures are never hidden (§1).
  - An orphan tag (a deleted colour) behaves like `null`.
- **When the popup opens,** it shows the picture of the colour that opens
  pre-selected (the first in-stock variant, `openProductModal`), not blindly
  the cover.
- **Only the first picture loads eagerly;** the rest use `loading="lazy"`,
  plus a preload of the neighbour when a swipe settles.

**Cart, checkout, "คำสั่งซื้อของฉัน" thumbnails** show the line's colour's
first picture, falling back to the cover (§10 Q3). This is one helper,
`pictureFor(product, colorId)`, used by all four, instead of four copies of a
rule.

The product **card** keeps one picture, the cover. A second picture on hover
is a desktop-only nicety and is left out (§11).

---

## 5. Sizes, zoom resolution, and the lightbox

- **Store larger masters:** product pictures shrink to **2400 px** on the long
  edge (today 2000), at the `image-resize.js` default quality.
  - Zoom is worth something only if those pixels exist.
  - Drive cost: about 600 KB a picture, which is nothing against 2 TB.
- **Serve by size from the one URL** (`pictureAt(url, w)` appends `=w{w}`):

  | Where | Size | Note |
  |---|---|---|
  | thumbnails | `=w200` | |
  | card | `=w600` | |
  | popup main | `srcset` `=w800 800w, =w1200 1200w` | |
  | lightbox | `=w2400` | ask the master, don't upscale |

- **Lightbox: PhotoSwipe 5** (MIT, v5.4.4 on 2026-09-22), not hand-written.
  - **Why a library:** pinch-zoom, double-tap zoom, pan limits, momentum,
    swipe-to-close, **back-button closes it**, focus trap and screen-reader
    labels are a large, well-solved problem. Hand-rolled pinch-zoom is exactly
    the kind of touch code this repo's `frontend-ui.md` keeps paying for.
  - **Loaded with a dynamic `import()` on the first tap** (CLAUDE.md: dynamic
    import only, never the entry bundle), with its CSS alongside. Buyers who
    never tap pay nothing.
  - **It needs each picture's `w`/`h`,** which we store at upload (§2). Legacy
    pictures with `w: null` are measured by loading the image once before
    opening. That covers the backfilled cover, and it heals on the next save.
  - **The Thai labels are set,** not left in English: ปิด, ถัดไป, ก่อนหน้า,
    ซูม.

---

## 6. Performance budget

- **The popup costs nothing extra on open:** one `=w800` picture, as today,
  plus about 5 KB thumbnails.
- **PhotoSwipe** is roughly 20 KB gzipped of JS + CSS, and only after the
  first tap.
- **Nothing is added to `core-*`.** The gallery module is part of the shop's
  lazy chunk, and the lightbox is its own chunk.

## 7. Accessibility

- **Alt text is generated:** `"<product name>"`, or `"<product name> สี<colour label>"`
  for a tagged picture, plus `" (รูปที่ n จาก N)"`. There is no field for an
  admin to leave blank.
- **The gallery is a labelled region.** Thumbnails are `<button>`s with
  `aria-current` on the active one, and the main picture is a `<button>` that
  opens the lightbox.
- **The lightbox** traps focus, Esc closes it, and focus returns to the
  picture that opened it (PhotoSwipe does this; verify it).

## 8. Readers of the picture — the checklist the build must clear

A migration carries columns, not readers (mistakes class 6). The fix is not
done until every row here is done, and the build adds a guard test: every
`image_url` / `images` occurrence in `src/js/shop/` must be in a registry with
its decision, so the next new reader is red until someone classifies it (the
`read-file.test.js` pattern).

| Reader | Today | After |
|---|---|---|
| Product card (`products.js`) | `image_url` | cover — unchanged (trigger-maintained) |
| Product popup | `background-image` | gallery + lightbox (§4, §5) |
| Announcement card fallback (`products.js` ~266) | product `image_url` | unchanged (cover) |
| Cart / checkout / my-orders thumbnails | `image_url` | `pictureFor(product, line.color)` |
| Admin products table, stock cards | `image_url` | cover — unchanged |
| Admin product editor | one picture | picture strip (§3) |
| Admin batch preview fallback | product `image_url` | unchanged (cover) |
| **Picture in-use check** (`trashImageIfUnused`, batch save, product save) | `image_url` | **every `images[].url` of every product** + batches + banners |
| Discord order message | none | none (DECIDED 2026-09-21: no images) |

## 9. Build order — each step shippable on its own

1. **Migration 0203:**
   - add `images`, the backfill, the cover trigger and `shop_images_ok`;
   - rename `shop_slip_url_ok` to `shop_drive_url_ok`, keeping a wrapper;
   - a proof (`shop0203-gallery`) covering:
     - the trigger in both directions, **including the stale-tab branch**;
     - the constraint refusing a 9th picture, a non-Google URL and an unknown
       key, **each beside an ALLOW**;
     - RLS unchanged: anon still cannot write.

   Safe before the client: old code writes `image_url`, and the trigger keeps
   `images` right.
2. **Admin picture strip and save flow** (§3), plus the in-use check that
   reads `images`. Ship it behind nothing: with one picture it behaves exactly
   like today.
3. **Popup gallery** (§4) without the colour link, plus `pictureFor` in the
   three thumbnail readers.
4. **Lightbox** (§5), with the dynamic import.
5. **Colour link** (§4): the jump-on-select and the opening picture. This is
   the small, optional part; it rides on `color` already stored in step 1.

Every step: `npm run build && npm test`; headless screenshots at 375 px and
1280 px; the served-bundle check. **A real iPhone check for pinch and back
button**, because headless Chrome has no touch.

## 10. Owner decisions — each has a default, so nothing waits

- **Q1. Most pictures per product?** Default **8**. That covers colours ×
  front/back plus a size chart. Each is an Apps Script upload on save.
- **Q2. Picking a colour: jump to its picture, or show ONLY its pictures?**
  Default **jump** (§1). Filtering hides the size chart and shared shots, and
  shows an empty gallery for an untagged colour.
- **Q3. Cart / order thumbnails show the chosen colour's picture?** Default
  **yes**. It shows what was ordered, and falls back to the cover.

## 11. Out of scope (said so it is not re-proposed as missing)

- Video, 360°, and a zoom lens on hover.
- A second picture on card hover (a desktop-only nicety; add later if asked).
- Per-SIZE pictures: sizes don't look different.
- Moving pictures off Drive: the 2 TB quota and lh3 resizing are why they are
  there (`uploads.js` header).
- The shop's Apps Script upload limits: already OWED separately
  (`HANDOFF.md` §18b). They apply to these uploads too, so do them before or
  with step 2.
