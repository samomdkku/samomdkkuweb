-- ============================================================
-- 0202 — the storefront's "stock left" uses the same rule as the order guard
--
-- FOUND (2026-09-22, shop bug sweep): two copies of one rule disagreed.
--   · place_shop_order (the guard that refuses an order) counts reserved stock
--     from NON-preorder items only — 0038's fix.
--   · shop_reserved_matrix / shop_reserved_matrix_all (what the storefront shows
--     as "left") count preorder items too.
-- 0038 put `coalesce(oi.is_preorder, false) = false` in all three. 0040 then
-- rebuilt the two display functions to drop the dead 'exchange' status and
-- started from a pre-0038 copy, so the preorder filter went with it. Nothing
-- failed: the guard still refused correctly; only the number shown was wrong.
--
-- WHEN IT BITES: a product that took preorders is switched to in-stock with
-- stock numbers. Its old preorder items are frozen `is_preorder = true` and are
-- not part of that stock, but the storefront subtracts them anyway — so a size
-- the server would sell shows as sold out. Measured on the day: 0 products in
-- that state (the one product with open preorder items has no stock numbers).
--
-- THIS SHAPE: the live bodies (read via pg_get_functiondef, not from 0040) with
-- only the preorder filter restored. 'exchange' stays out on purpose — 0040's
-- constraint forbids it and 0 rows hold it.
-- Guard against the next copy: src/js/shop/reserved-rule.test.js asserts the
-- LATEST definition of all three functions carries the filter.
-- ============================================================

create or replace function public.shop_reserved_matrix(p_product_id text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, qty), '{}'::jsonb)
  from (
    select
      coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
      sum(oi.qty)::int as qty
    from public.shop_order_items oi
    join public.shop_orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and coalesce(oi.is_preorder, false) = false
      and o.status in (
        'pending', 'review', 'paid', 'produce', 'ready', 'slip_mismatch'
      )
      and coalesce(oi.item_status, 'paid') <> 'done'
    group by oi.size, oi.color
  ) sub;
$$;

create or replace function public.shop_reserved_matrix_all()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(product_id, matrix), '{}'::jsonb)
  from (
    select product_id, jsonb_object_agg(key, qty) as matrix
    from (
      select
        oi.product_id,
        coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
        sum(oi.qty)::int as qty
      from public.shop_order_items oi
      join public.shop_orders o on o.id = oi.order_id
      where coalesce(oi.is_preorder, false) = false
        and o.status in (
          'pending', 'review', 'paid', 'produce', 'ready', 'slip_mismatch'
        )
        and coalesce(oi.item_status, 'paid') <> 'done'
      group by oi.product_id, oi.size, oi.color
    ) sub
    group by product_id
  ) outer_grouped;
$$;


-- ------------------------------------------------------------
-- (2) a slip URL a buyer can write is a Google-hosted image URL — nothing
--     else. Used by place_shop_order and the buyer self-update guard below.
--     Every slip URL live on 2026-09-22 is lh3.googleusercontent.com; the
--     uploader can also hand back drive.google.com. The character set leaves
--     out quotes, spaces and angle brackets on purpose: the value is shown to
--     admins, and a quote in it once reached an <img src="…"> unescaped.
-- ------------------------------------------------------------
create or replace function public.shop_slip_url_ok(p_url text)
returns boolean
language sql immutable
as $$
  select p_url ~ '^https://(lh3\.googleusercontent\.com|drive\.google\.com)/[A-Za-z0-9/_=?&.%-]+$'
$$;

-- ------------------------------------------------------------
-- (3) place_shop_order, for a buyer (admins keep their walk-in path):
--   · refuses a colour the product does not offer (COLOR_UNAVAILABLE);
--   · requires a slip (NO_SLIP) — the client only let a dev skip it, but the
--     RPC accepted a slip-less order from anyone, and a 'pending' order holds
--     stock, so a direct call could hold all of it;
--   · caps a line at 99 (the client's cap; the server had none);
--   · counts stock ACROSS the lines of one call — two lines for the same
--     size/colour were each checked against stock without the other;
--   · accepts only a Google-hosted slip URL (shop_slip_url_ok);
--   · upper-cases the order-code prefix BEFORE stripping, as the client does
--     ("rt69" became "69").
--
-- FOUND the same day: size was validated (0199), colour never was. Stock is
-- keyed `<size>-<colour>`, so a colour with no cell reads as "stock not set" —
-- unlimited — and the stock check is skipped. A cart line carted before an
-- admin changed a product's colours (or any hand-made call) could order a
-- colour/size that has run out. Rebuilt from the LIVE body
-- (pg_get_functiondef, 2026-09-22); the only change is the COLOR_UNAVAILABLE
-- block. The client translates it (src/js/shop/api.js placeShopOrder).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_shop_order(p_buyer_id uuid, p_buyer_label text, p_buyer_name text, p_buyer_email text, p_buyer_phone text, p_buyer_note text, p_pickup_location text, p_slip_url text, p_slip_uploaded_at timestamp with time zone, p_slips jsonb, p_items jsonb, p_fee integer DEFAULT 0)
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
        v_key := v_product_id || '|' || v_size || '-' || v_color;
        v_reserved := v_reserved + coalesce((v_asked ->> v_key)::int, 0);
        v_asked := v_asked || jsonb_build_object(v_key, coalesce((v_asked ->> v_key)::int, 0) + v_qty);
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


-- ------------------------------------------------------------
-- (4) the buyer self-update guard: status, timeline stage and slip URLs.
--
-- FOUND the same day: the guard let a buyer write `status`, `timeline` and
-- `slips` (their slip flows need all three), and the RLS WITH CHECK only kept
-- the status inside pending/review/slip_mismatch. So a buyer could set
-- 'slip_mismatch' or leave it for 'review' with no new slip, append a
-- {stage:'paid'} entry the admin timeline shows as a payment step, and put
-- any URL in `slips`. Rebuilt from the LIVE body; the additions are marked 0202.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shop_orders_self_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_old_t jsonb;
  v_new_t jsonb;
  v_n     integer;
  i       integer;
  e       jsonb;
begin
  -- Shop admins: their own RLS policy (shop_orders_update_admin) is the boundary.
  if public.current_user_is_shop_admin() then
    return new;
  end if;
  -- Not the buyer self-update path. Server contexts (place_shop_order,
  -- service_role, migrations) have a null auth.uid(); everyone else is already
  -- refused by RLS.
  if v_uid is null or v_uid is distinct from old.buyer_id then
    return new;
  end if;

  -- Deny every column except the ones the buyer flows actually write.
  -- `buyer_email` joins `buyer_phone` in 0150: both are contact fields the buyer
  -- already types on the INSERT path, and the raise below has always described
  -- this set as "ข้อมูลติดต่อ".
  if (to_jsonb(old) - 'buyer_phone' - 'buyer_email' - 'slips' - 'slip_url'
                    - 'slip_uploaded_at' - 'status' - 'timeline' - 'updated_at')
     is distinct from
     (to_jsonb(new) - 'buyer_phone' - 'buyer_email' - 'slips' - 'slip_url'
                    - 'slip_uploaded_at' - 'status' - 'timeline' - 'updated_at') then
    raise exception 'ผู้ซื้อแก้ไขได้เฉพาะสลิปและข้อมูลติดต่อของตนเองเท่านั้น'
      using errcode = 'P0001',
            detail  = 'shop_orders_self_update_guard: price/admin fields are not buyer-writable';
  end if;

  -- 0202: a buyer moves their own order only between 'pending' (no slip) and
  -- 'review' (slip sent) — 'slip_mismatch' is an admin's verdict, and a buyer
  -- could set it, or clear it to 'review' with no new slip.
  if new.status is distinct from old.status and new.status not in ('pending', 'review') then
    raise exception 'ผู้ซื้อเปลี่ยนสถานะคำสั่งซื้อเป็นสถานะนี้ไม่ได้' using errcode = 'P0001';
  end if;
  -- 0202: a slip URL a buyer writes is a Google-hosted image (shop_slip_url_ok).
  if new.slip_url is distinct from old.slip_url and new.slip_url is not null
     and not public.shop_slip_url_ok(new.slip_url) then
    raise exception 'ลิงก์สลิปไม่ถูกต้อง' using errcode = 'P0001';
  end if;
  if new.slips is distinct from old.slips and exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof(new.slips) = 'array'
                                               then new.slips else '[]'::jsonb end) x
        where not public.shop_slip_url_ok(x ->> 'url')
          and not coalesce(old.slips, '[]'::jsonb) @> jsonb_build_array(x)) then
    raise exception 'ลิงก์สลิปไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  -- Timeline: append-only, and an appended entry may not claim an author.
  -- The buyer flows push {stage, at, label}; only admin entries carry `by`,
  -- which is what made the forged '{"by":"admin"}' entry above possible.
  v_old_t := coalesce(old.timeline, '[]'::jsonb);
  v_new_t := coalesce(new.timeline, '[]'::jsonb);
  if v_new_t <> v_old_t then
    if jsonb_typeof(v_new_t) <> 'array' then
      raise exception 'รูปแบบไทม์ไลน์ไม่ถูกต้อง' using errcode = 'P0001';
    end if;
    v_n := jsonb_array_length(v_old_t);
    if jsonb_array_length(v_new_t) < v_n then
      raise exception 'ไม่สามารถลบประวัติของคำสั่งซื้อได้' using errcode = 'P0001';
    end if;
    for i in 0 .. v_n - 1 loop
      if (v_new_t -> i) is distinct from (v_old_t -> i) then
        raise exception 'ไม่สามารถแก้ไขประวัติเดิมของคำสั่งซื้อได้' using errcode = 'P0001';
      end if;
    end loop;
    if jsonb_array_length(v_new_t) > 200 then
      raise exception 'ประวัติของคำสั่งซื้อยาวเกินไป' using errcode = 'P0001';
    end if;
    for i in v_n .. jsonb_array_length(v_new_t) - 1 loop
      e := v_new_t -> i;
      if e ? 'by' then
        raise exception 'ไม่สามารถระบุผู้ดำเนินการในประวัติได้' using errcode = 'P0001';
      end if;
      -- 0202: the buyer flows only ever append these two stages. A buyer-
      -- written {stage:'paid'} showed on the admin timeline as a payment step.
      if coalesce(e ->> 'stage', '') not in ('pending', 'review') then
        raise exception 'ไม่สามารถเพิ่มขั้นตอนนี้ในประวัติได้' using errcode = 'P0001';
      end if;
      if char_length(coalesce(e ->> 'label', '')) > 200 then
        raise exception 'ข้อความในประวัติยาวเกินไป' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  return new;
end;
$function$;
