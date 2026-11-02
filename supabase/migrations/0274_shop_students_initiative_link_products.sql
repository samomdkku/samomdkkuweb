-- ============================================================
-- 0274 — SAMO Shop: "Students initiative" products that link OUT.
--
-- Owner, 2026-11-02: the shop can list a product that is sold somewhere else.
-- It looks like any product (pictures, name, text, description), the filter
-- groups it under "Students initiative" (SAMO official = MD · MDI · RT), and
-- the buyer's button opens the admin's link instead of the cart.
--
-- ONE FACT, ONE COLUMN PAIR. Such a product is `source = 'student'`, and
-- `shop_products_student_has_link` makes that true EXACTLY when it has an
-- `external_url`. The filter, the card label and the "cannot be ordered here"
-- rule all read it, so the three cannot disagree (two columns holding one
-- fact drift — .claude/rules/mistakes.md class 6 — unless a constraint ties
-- them).
--
-- NEVER ORDERABLE, ON EVERY PATH. The page never offers the cart for one,
-- but a page is not a gate. `shop_order_items_no_link_products` refuses an
-- item for a link product at the TABLE, so place_shop_order (buyer), the admin
-- walk-in order and any future writer are all covered without restating it in
-- each (class 4: hold a rule at the transport, not in every message). Same
-- error text place_shop_order already raises for an unavailable product, so
-- the checkout's existing message handles it.
--
-- AND A PRODUCT WITH ORDERS CANNOT BECOME ONE: switching it to `student` would
-- leave paid orders for something the shop no longer sells.
--
-- ADD-ONLY: two nullable columns, a WIDER source check, a check no existing
-- row violates (none is `student`, none has a link), two triggers. The bundle
-- served before this deploys never writes the new columns, so it keeps
-- working; apply first, then deploy.
-- ============================================================

alter table public.shop_products
  add column if not exists external_url   text,
  add column if not exists external_label text;

comment on column public.shop_products.external_url is
  'Students initiative (0274): where the buyer goes to see or buy it. Set exactly when source = ''student''; such a product is never orderable here.';
comment on column public.shop_products.external_label is
  'Optional text on the buyer''s button for a link product (0274); the page has a default.';

alter table public.shop_products drop constraint if exists shop_products_source_check;
alter table public.shop_products add constraint shop_products_source_check
  check (source = any (array['md', 'rt', 'mdi', 'sittikao', 'student']));

alter table public.shop_products drop constraint if exists shop_products_student_has_link;
alter table public.shop_products add constraint shop_products_student_has_link
  check ((source = 'student') = (external_url is not null));

alter table public.shop_products drop constraint if exists shop_products_external_url_ok;
alter table public.shop_products add constraint shop_products_external_url_ok
  check (external_url is null
         or (external_url ~ '^https://[^[:space:]]+$' and length(external_url) <= 2000));

alter table public.shop_products drop constraint if exists shop_products_external_label_ok;
alter table public.shop_products add constraint shop_products_external_label_ok
  check (external_label is null or length(external_label) between 1 and 40);

-- ── never an order item ────────────────────────────────────────────────────
-- SECURITY DEFINER: the buyer's insert runs under RLS, and an inactive link
-- product is invisible to a buyer — an invoker read would find no row and let
-- the item through (an unresolvable reference fails OPEN, class 2).
create or replace function public.shop_order_items_no_link_products()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.shop_products p
              where p.id = new.product_id and p.source = 'student') then
    raise exception 'PRODUCT_UNAVAILABLE: %', new.product_id using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.shop_order_items_no_link_products() from public, anon, authenticated;

drop trigger if exists shop_order_items_no_link_products on public.shop_order_items;
create trigger shop_order_items_no_link_products
  before insert or update of product_id on public.shop_order_items
  for each row execute function public.shop_order_items_no_link_products();

-- ── a product that has orders stays a shop product ─────────────────────────
create or replace function public.shop_products_keep_ordered_in_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'student' and old.source is distinct from 'student'
     and exists (select 1 from public.shop_order_items i where i.product_id = old.id) then
    raise exception 'HAS_ORDERS: %', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.shop_products_keep_ordered_in_shop() from public, anon, authenticated;

drop trigger if exists shop_products_keep_ordered_in_shop on public.shop_products;
create trigger shop_products_keep_ordered_in_shop
  before update of source on public.shop_products
  for each row execute function public.shop_products_keep_ordered_in_shop();
