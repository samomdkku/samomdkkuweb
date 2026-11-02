-- ============================================================
-- shop0274-students-initiative.sql — link-out products (0274), both directions
--   §A the shape: `student` ⇔ a link; https only; a label ≤ 40
--   §B a visitor READS the link of an active one (the page needs it)
--   §C a BUYER cannot order one through place_shop_order — and CAN order an
--      ordinary product in the same call shape (the control: a refusal alone
--      cannot tell the guard from a broken checkout)
--   §D no path writes an order item for one (the table refuses, not the RPC)
--   §E a product with orders cannot become one; one without orders can
-- Its own products (probe0274*), rolled back.
--
--   node tools/db-query.mjs tools/shop0274-students-initiative.sql [--dev]
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || split_part(sqlerrm, ':', 1); end $$;

insert into public.shop_products (id, name, type, source, price, sizes, is_active, stock_status, is_presale)
values ('probe0274shop', 'probe0274shop', 'apparel-shirt', 'md', 100, array['M'], true, 'available', false);

-- ── §A shape ───────────────────────────────────────────────────────────────
insert into probe select 'A1. a Students initiative product with an https link is accepted', 'ok',
  pg_temp.try($q$insert into public.shop_products (id, name, type, source, price, sizes, is_active, stock_status, external_url, external_label)
                 values ('probe0274link', 'probe0274link', 'apparel-shirt', 'student', 0, array['F'], true, 'available',
                         'https://forms.gle/probe0274', 'สั่งผ่านฟอร์ม')$q$);
insert into probe select 'A2. student with NO link is refused', 'raised',
  split_part(pg_temp.try($q$insert into public.shop_products (id, name, type, source, price, is_active, stock_status)
                 values ('probe0274x1', 'x', 'apparel-shirt', 'student', 0, true, 'available')$q$), ':', 1);
insert into probe select 'A3. a link on an MD product is refused', 'raised',
  split_part(pg_temp.try($q$insert into public.shop_products (id, name, type, source, price, is_active, stock_status, external_url)
                 values ('probe0274x2', 'x', 'apparel-shirt', 'md', 0, true, 'available', 'https://example.org')$q$), ':', 1);
insert into probe select 'A4. an http:// (or javascript:) link is refused', 'raised|raised',
  split_part(pg_temp.try($q$insert into public.shop_products (id, name, type, source, price, is_active, stock_status, external_url)
                 values ('probe0274x3', 'x', 'apparel-shirt', 'student', 0, true, 'available', 'http://example.org')$q$), ':', 1)
  || '|' || split_part(pg_temp.try($q$insert into public.shop_products (id, name, type, source, price, is_active, stock_status, external_url)
                 values ('probe0274x4', 'x', 'apparel-shirt', 'student', 0, true, 'available', 'javascript:alert(1)')$q$), ':', 1);
insert into probe select 'A5. a button label over 40 characters is refused', 'raised',
  split_part(pg_temp.try($q$update public.shop_products set external_label = repeat('ก', 41) where id = 'probe0274link'$q$), ':', 1);

-- ── §B a visitor reads it ──────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into probe select 'B1. a visitor reads the link and label of an active one', 'https://forms.gle/probe0274|สั่งผ่านฟอร์ม',
  (select external_url || '|' || external_label from public.shop_products where id = 'probe0274link');
reset role;

-- ── §C the buyer's checkout ────────────────────────────────────────────────
create temporary table who on commit drop as
select (select u.id from public.users u
         where u.role = 'user' and coalesce(array_length(u.permissions,1),0) = 0
           and coalesce(array_length(u.managed_permissions,1),0) = 0
         order by u.id limit 1) as buyer;
grant select on who to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select buyer from who), 'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  insert into probe values ('C0. subject: the buyer is not a shop admin', 'false', public.current_user_is_shop_admin()::text);
  begin
    perform public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0274=w1200',null,'[]'::jsonb,
      '[{"product_id":"probe0274link","size":"F","qty":1}]'::jsonb, 0);
    insert into probe values ('C1. a link product cannot be ordered', 'PRODUCT_UNAVAILABLE', 'ACCEPTED');
  exception when others then insert into probe values ('C1. a link product cannot be ordered', 'PRODUCT_UNAVAILABLE', split_part(sqlerrm, ':', 1)); end;
  begin
    perform public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0274=w1200',null,'[]'::jsonb,
      '[{"product_id":"probe0274shop","size":"M","qty":1}]'::jsonb, 0);
    insert into probe values ('C2. CONTROL: the same buyer orders an ordinary product', 'placed', 'placed');
  exception when others then insert into probe values ('C2. CONTROL: the same buyer orders an ordinary product', 'placed', sqlerrm); end;
end $$;
reset role;

-- ── §D the table refuses, whoever writes ───────────────────────────────────
-- As the owner role (an admin's walk-in path bypasses the RPC's checks).
insert into probe select 'D1. no order item for a link product, even written directly', 'raised: PRODUCT_UNAVAILABLE',
  pg_temp.try($q$insert into public.shop_order_items (order_id, product_id, size, qty, unit_price)
                 select i.order_id, 'probe0274link', 'F', 1, 0 from public.shop_order_items i where i.product_id = 'probe0274shop' limit 1$q$);
insert into probe select 'D2. …nor by pointing an existing item at one', 'raised: PRODUCT_UNAVAILABLE',
  pg_temp.try($q$update public.shop_order_items set product_id = 'probe0274link' where product_id = 'probe0274shop'$q$);

-- ── §E a product that has orders stays in the shop ─────────────────────────
insert into probe select 'E1. a product WITH orders cannot become a link product', 'raised: HAS_ORDERS',
  pg_temp.try($q$update public.shop_products set source = 'student', external_url = 'https://example.org/x' where id = 'probe0274shop'$q$);
insert into public.shop_products (id, name, type, source, price, is_active, stock_status)
values ('probe0274plain', 'probe0274plain', 'apparel-shirt', 'mdi', 0, true, 'available');
insert into probe select 'E2. CONTROL: one WITHOUT orders can', 'ok',
  pg_temp.try($q$update public.shop_products set source = 'student', external_url = 'https://example.org/y' where id = 'probe0274plain'$q$);

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
