-- 0199_shop_price_per_size_and_server_side_pricing.sql
--
-- "make admin samoshop can custom the price for each size of the สินค้า both
-- normal and preorder" (owner, 2026-09-21).
--
-- A per-size price is only real if the DATABASE charges it. Reading the live
-- place_shop_order to add it showed that it charged nothing of its own: it
-- stored whatever `unit_price` and `p_buyer_id` the caller sent, and it was
-- executable by PUBLIC/anon. Measured on production in a rolled-back
-- transaction the same day:
--
--   anon  → place_shop_order(<someone else's id>, …, unit_price 0)   ACCEPTED
--   buyer → insert into shop_orders (status 'paid', total 0)          ACCEPTED
--
-- So a price column the browser reads would have been decoration. This
-- migration makes the price a SERVER fact and closes both doors:
--
--   1. shop_products.price_by_size / preorder_price_by_size — { "<size>": int }.
--      Absent size → the product's base price, so every existing product is
--      unchanged ('{}' default).
--   2. public.shop_unit_price(product, size) — the ONE home of the rule.
--      Preorder: preorder-by-size → preorder_price → price-by-size → price.
--      Normal:   price-by-size → price.
--      src/js/shop/data.js unitPriceFor() mirrors it for DISPLAY only; the
--      shared cases in src/js/shop/price-cases.json are asserted against both
--      (data.test.js and tools/shop0199-pricing.sql).
--   3. place_shop_order, for anyone who is not a shop admin:
--        * must be signed in, and may only order as themselves
--        * unit_price is COMPUTED (the sent one is ignored), fee is 0
--        * the product must exist, be on sale, and the size must be one it has
--      Shop admins keep the old behaviour on purpose — adminCreateOrder places
--      walk-in orders with buyer_id null and a hand-typed price.
--   4. EXECUTE revoked from PUBLIC/anon.
--   5. The buyer INSERT policies on shop_orders / shop_order_items are dropped.
--      Since 0034 every buyer order goes through the RPC (a definer, so it does
--      not need them); they survived only for a pre-0030 fallback, and they are
--      what let a buyer write an order that says 'paid'.

alter table public.shop_products
  add column if not exists price_by_size          jsonb not null default '{}'::jsonb,
  add column if not exists preorder_price_by_size jsonb not null default '{}'::jsonb;

-- An object of non-negative whole numbers, nothing else.
alter table public.shop_products drop constraint if exists shop_products_price_by_size_shape;
alter table public.shop_products add constraint shop_products_price_by_size_shape check (
  jsonb_typeof(price_by_size) = 'object'
  and not jsonb_path_exists(price_by_size, '$.* ? (@.type() != "number" || @ < 0 || @ != @.floor())')
);
alter table public.shop_products drop constraint if exists shop_products_preorder_price_by_size_shape;
alter table public.shop_products add constraint shop_products_preorder_price_by_size_shape check (
  jsonb_typeof(preorder_price_by_size) = 'object'
  and not jsonb_path_exists(preorder_price_by_size, '$.* ? (@.type() != "number" || @ < 0 || @ != @.floor())')
);

create or replace function public.shop_unit_price(p public.shop_products, p_size text)
returns integer language sql immutable as $$
  select case when coalesce(p.is_presale, false) then
    coalesce((p.preorder_price_by_size ->> p_size)::int,
             p.preorder_price,
             (p.price_by_size ->> p_size)::int,
             p.price, 0)
  else
    coalesce((p.price_by_size ->> p_size)::int, p.price, 0)
  end
$$;

create or replace function public.place_shop_order(p_buyer_id uuid, p_buyer_label text, p_buyer_name text, p_buyer_email text, p_buyer_phone text, p_buyer_note text, p_pickup_location text, p_slip_url text, p_slip_uploaded_at timestamp with time zone, p_slips jsonb, p_items jsonb, p_fee integer DEFAULT 0)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id           text;
  v_subtotal           int := 0;
  v_total              int := 0;
  v_item               jsonb;
  v_product_id         text;
  v_size               text;
  v_color              text;
  v_qty                int;
  v_unit_price         int;
  v_is_preorder        boolean := false;
  v_item_is_preorder   boolean;
  v_prod_status        text;
  v_item_status        text;
  v_stock_raw          text;
  v_stock              int;
  v_reserved           int;
  v_code               text;
  v_attempt            int;
  v_product_ids        text[];
  v_now                timestamptz := now();
  v_initial_status     text;
  v_initial_timeline   jsonb;
  v_is_admin           boolean := public.current_user_is_shop_admin();
  v_product            public.shop_products;
  v_prices             jsonb := '{}'::jsonb;  -- item index → unit price actually charged
  v_i                  int := 0;
  v_fee                int := coalesce(p_fee, 0);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  -- 0199: a buyer orders as themselves, at the catalogue's price, for free.
  if not v_is_admin then
    if auth.uid() is null or p_buyer_id is distinct from auth.uid() then
      raise exception 'NOT_YOUR_ORDER' using errcode = 'P0001';
    end if;
    v_fee := 0;
  end if;

  select array_agg(distinct (item->>'product_id') order by (item->>'product_id'))
    into v_product_ids
    from jsonb_array_elements(p_items) item;

  perform 1 from public.shop_products where id = any(v_product_ids) for update;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_item->>'product_id';
    v_size       := coalesce(v_item->>'size', 'F');
    v_color      := coalesce(v_item->>'color', 'default');
    v_qty        := coalesce((v_item->>'qty')::int, 0);

    if v_qty <= 0 then
      raise exception 'INVALID_QTY: %', v_product_id;
    end if;

    select * into v_product from public.shop_products where id = v_product_id;

    if v_is_admin then
      v_unit_price := coalesce((v_item->>'unit_price')::int, 0);
    else
      if v_product.id is null or not coalesce(v_product.is_active, false)
         or v_product.stock_status in ('sold_out', 'production_closed') then
        raise exception 'PRODUCT_UNAVAILABLE: %', v_product_id using errcode = 'P0001';
      end if;
      if coalesce(array_length(v_product.sizes, 1), 0) > 0
           and not (v_size = any(v_product.sizes))
         or coalesce(array_length(v_product.sizes, 1), 0) = 0 and v_size <> 'F' then
        raise exception 'SIZE_UNAVAILABLE: % %', v_product_id, v_size using errcode = 'P0001';
      end if;
      v_unit_price := public.shop_unit_price(v_product, v_size);
    end if;
    v_prices := v_prices || jsonb_build_object(v_i::text, v_unit_price);
    v_i := v_i + 1;

    v_item_is_preorder := coalesce(v_product.is_presale, false);

    if v_item_is_preorder then
      v_is_preorder := true;
    else
      v_stock_raw := v_product.stock_matrix ->> (v_size || '-' || v_color);
      v_stock := nullif(v_stock_raw, '')::int;
      if v_stock is not null then
        v_reserved := coalesce(
          (select sum(oi.qty)::int
             from public.shop_order_items oi
             join public.shop_orders o on o.id = oi.order_id
             where oi.product_id = v_product_id
               and coalesce(oi.is_preorder, false) = false
               and coalesce(oi.size, 'F') = v_size
               and coalesce(oi.color, 'default') = v_color
               and o.status in ('pending','review','paid','produce','ready','slip_mismatch','exchange')
               and coalesce(oi.item_status, 'paid') <> 'done'),
          0
        );
        if (v_stock - v_reserved) < v_qty then
          raise exception 'OUT_OF_STOCK: % %/% (stock=% reserved=% requested=%)',
            v_product_id, v_size, v_color, v_stock, v_reserved, v_qty;
        end if;
      end if;
    end if;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_total := v_subtotal + v_fee;

  select code into v_code
    from public.shop_products
    where id = (p_items->0->>'product_id');
  v_code := upper(regexp_replace(coalesce(v_code, 'SH'), '[^A-Z0-9]', '', 'g'));
  if length(v_code) = 0 then v_code := 'SH'; end if;
  v_code := left(v_code, 5);

  if p_slip_url is not null and p_slip_url <> '' then
    v_initial_status := 'review';
    v_initial_timeline := jsonb_build_array(
      jsonb_build_object('stage', 'pending', 'at', v_now, 'label', 'รอชำระเงิน'),
      jsonb_build_object('stage', 'review',  'at', v_now, 'label', 'ส่งสลิปแล้ว — รอตรวจ')
    );
  else
    v_initial_status := 'pending';
    v_initial_timeline := jsonb_build_array(
      jsonb_build_object('stage', 'pending', 'at', v_now, 'label', 'รอชำระเงิน')
    );
  end if;

  v_attempt := 0;
  loop
    v_order_id := v_code || lpad((1000 + (random() * 8999)::int)::text, 4, '0');
    begin
      insert into public.shop_orders
        (id, buyer_id, buyer_label, buyer_name, buyer_email, buyer_phone, buyer_note,
         status, subtotal, fee, total, pickup_location, is_preorder,
         slip_url, slip_uploaded_at, slips, timeline, placed_at, updated_at)
      values
        (v_order_id, p_buyer_id, p_buyer_label, p_buyer_name, p_buyer_email, p_buyer_phone, p_buyer_note,
         v_initial_status, v_subtotal, v_fee, v_total, p_pickup_location, v_is_preorder,
         nullif(p_slip_url, ''), p_slip_uploaded_at, coalesce(p_slips, '[]'::jsonb),
         v_initial_timeline, v_now, v_now);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 10 then
        raise exception 'ID_GENERATION_FAILED';
      end if;
    end;
  end loop;

  -- Insert items with frozen is_preorder snapshot + seeded item_status, at the
  -- unit price computed above (NOT the one the caller sent).
  v_i := 0;
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_item->>'product_id';

    select is_presale, production_status
      into v_item_is_preorder, v_prod_status
      from public.shop_products where id = v_product_id;
    v_item_is_preorder := coalesce(v_item_is_preorder, false);

    v_item_status := case coalesce(v_prod_status, 'pending')
                       when 'announced' then 'ready'
                       when 'produced'  then 'produce'
                       else 'paid'
                     end;

    insert into public.shop_order_items
      (order_id, product_id, size, color, fit, qty, unit_price, is_preorder, item_status)
    values
      (v_order_id,
       v_product_id,
       coalesce(v_item->>'size', 'F'),
       coalesce(v_item->>'color', 'default'),
       coalesce(v_item->>'fit', 'unisex'),
       (v_item->>'qty')::int,
       (v_prices ->> v_i::text)::int,
       v_item_is_preorder,
       v_item_status);
    v_i := v_i + 1;
  end loop;

  return v_order_id;
end;
$function$;

revoke execute on function public.place_shop_order(uuid,text,text,text,text,text,text,text,timestamp with time zone,jsonb,jsonb,integer) from public, anon;
grant  execute on function public.place_shop_order(uuid,text,text,text,text,text,text,text,timestamp with time zone,jsonb,jsonb,integer) to authenticated;

drop policy if exists shop_orders_insert_buyer on public.shop_orders;
drop policy if exists shop_order_items_insert_buyer on public.shop_order_items;
