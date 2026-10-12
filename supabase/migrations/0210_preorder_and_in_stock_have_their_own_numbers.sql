-- ============================================================
-- 0210 — preorder and in-stock each have their OWN numbers
--
-- REPORTED (2026-10-12, after 0209): "i want admin to can custom stocks of
-- preorder and stocks of normal" — and, for polo-caffeine, "move the current
-- number of stocks ... to the preorder". Owner chose ONE MODE AT A TIME: the
-- Preorder tick decides which table counts; switching never reuses or wipes
-- the other table.
--
-- 0209 made the single `stock_matrix` mean "run size" while a product is a
-- preorder and "on the shelf" otherwise, so switching modes silently changed
-- what the same numbers meant. Now:
--   · `stock_matrix`          — in-stock numbers, used when is_presale = false
--   · `preorder_stock_matrix` — preorder numbers, used when is_presale = true
--   · `shop_active_stock(p)`  — the ONE place that picks between them; the
--     order guard asks it, and the storefront's activeStock() is its JS twin.
-- What counts as TAKEN is unchanged (shop_reserved_matrix, 0209).
--
-- DATA: every preorder product's current numbers WERE its preorder limit
-- under 0209, so they move to the new table and its in-stock table empties.
-- Measured before writing this: one product qualifies, polo-caffeine
-- (100 across 8 sizes). An in-stock product is untouched.
--
-- ADD-ONLY, so safe before the frontend ships. Between the two, the old
-- storefront reads polo's (now empty) in-stock table and shows no limit
-- while the guard still enforces 89 left — the guard is the one that holds.
--
-- Proof: tools/shop0210-two-tables.mjs. Guard: reserved-rule.test.js.
-- ============================================================

alter table public.shop_products
  add column if not exists preorder_stock_matrix jsonb not null default '{}'::jsonb;

comment on column public.shop_products.preorder_stock_matrix is
  'Preorder limit per size-colour cell, used while is_presale = true (0210). Empty = unlimited. stock_matrix is the in-stock table, used otherwise. Pick between them with shop_active_stock().';

update public.shop_products
   set preorder_stock_matrix = stock_matrix,
       stock_matrix = '{}'::jsonb
 where is_presale
   and stock_matrix <> '{}'::jsonb
   and preorder_stock_matrix = '{}'::jsonb;

create or replace function public.shop_active_stock(p public.shop_products)
returns jsonb
language sql immutable
as $$
  select case when coalesce(p.is_presale, false)
              then coalesce(p.preorder_stock_matrix, '{}'::jsonb)
              else coalesce(p.stock_matrix, '{}'::jsonb) end;
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
  v_asked              jsonb := '{}'::jsonb;  -- product|size-colour → qty earlier in THIS call
  v_key                text;
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
    if coalesce(p_slip_url, '') = '' then
      raise exception 'NO_SLIP' using errcode = 'P0001';
    end if;
    if not public.shop_slip_url_ok(p_slip_url)
       or exists (select 1 from jsonb_array_elements(coalesce(p_slips, '[]'::jsonb)) s
                   where not public.shop_slip_url_ok(s ->> 'url')) then
      raise exception 'BAD_SLIP_URL' using errcode = 'P0001';
    end if;
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

    if v_qty <= 0 or (not v_is_admin and v_qty > 99) then
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
      -- 0202: the colour must be one the product offers ('default' when it
      -- offers none). An unknown colour has no stock cell, so the stock check
      -- below would skip it — a cart line from before an admin changed the
      -- colours could oversell a size that has run out.
      if (case when jsonb_typeof(v_product.colors) = 'array'
                    and jsonb_array_length(v_product.colors) > 0
               then not exists (select 1 from jsonb_array_elements(v_product.colors) c
                                 where c ->> 'id' = v_color)
               else v_color <> 'default' end) then
        raise exception 'COLOR_UNAVAILABLE: % %', v_product_id, v_color using errcode = 'P0001';
      end if;
      v_unit_price := public.shop_unit_price(v_product, v_size);
    end if;
    v_prices := v_prices || jsonb_build_object(v_i::text, v_unit_price);
    v_i := v_i + 1;

    v_item_is_preorder := coalesce(v_product.is_presale, false);
    if v_item_is_preorder then
      v_is_preorder := true;
    end if;

    -- 0209: a preorder with numbers is LIMITED too, and what counts as taken
    -- comes from shop_reserved_matrix — the function the storefront reads.
    -- 0210: which numbers is shop_active_stock's answer (preorder table when
    -- the Preorder tick is on, in-stock table otherwise). A blank cell is
    -- still unchecked.
    v_stock_raw := public.shop_active_stock(v_product) ->> (v_size || '-' || v_color);
    v_stock := nullif(v_stock_raw, '')::int;
    if v_stock is not null then
      v_reserved := coalesce(
        (public.shop_reserved_matrix(v_product_id) ->> (v_size || '-' || v_color))::int, 0);
      v_key := v_product_id || '|' || v_size || '-' || v_color;
      v_reserved := v_reserved + coalesce((v_asked ->> v_key)::int, 0);
      v_asked := v_asked || jsonb_build_object(v_key, coalesce((v_asked ->> v_key)::int, 0) + v_qty);
      if (v_stock - v_reserved) < v_qty then
        raise exception 'OUT_OF_STOCK: % %/% (stock=% reserved=% requested=%)',
          v_product_id, v_size, v_color, v_stock, v_reserved, v_qty;
      end if;
    end if;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_total := v_subtotal + v_fee;

  select code into v_code
    from public.shop_products
    where id = (p_items->0->>'product_id');
  v_code := regexp_replace(upper(coalesce(v_code, 'SH')), '[^A-Z0-9]', '', 'g');
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
