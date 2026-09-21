-- 0201_a_pickup_announcement_can_carry_a_picture.sql
--
-- "the ลายทาง at leftside of ประกาศรับสินค้า … client อยากได้เป็นรูปสินค้า"
-- (owner, 2026-09-21).
--
-- The pickup card's left panel was a decorative stripe. The obvious source for
-- a product picture — the batch's own `product_ids` — is not enough on its own:
-- the live announcement (น้องอุ่นใจผลิตเสร็จแล้ว) names a product that has since
-- been DELETED, so it would have had nothing to show. So the announcement gets
-- its own picture, which the storefront prefers; after that it falls back to
-- the first linked product that has one, and only then to the stripe.
--
-- ADD-only: the served bundle never asks for this column, so it is safe to apply
-- before the code that reads it. RLS is unchanged — the existing policies are
-- row policies (public read of active rows, shop-admin write) and the table
-- grants are table-wide, so the new column inherits both.
alter table public.shop_pickup_batches add column if not exists image_url text;
comment on column public.shop_pickup_batches.image_url is
  'Picture shown on the storefront pickup card (0201). Null → first linked product image → stripe.';
