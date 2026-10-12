#!/usr/bin/env node
// ============================================================
// shop0209-preorder-limit.mjs — a preorder product's stock grid runs down, and
//                               nothing else about stock changed.
//
// One transaction that ROLLS BACK. Products only this proof uses:
//   probe0209p — PREORDER, size M, preorder table M-default = 2 (0210)
//   probe0209u — PREORDER, size M, empty grid (unlimited, as before 0209)
//   probe0209s — IN STOCK, size M, grid M-default = 2
//
//  1. WHAT COUNTS (preorder). A delivered preorder COUNTS (the grid is the
//     run's size); a cancelled one does NOT. Display and the all-products copy
//     agree.
//  2. DISPLAY vs GUARD (preorder). 2 − 1 delivered = 1 left: the guard sells
//     exactly that 1, then refuses — ALLOW and DENY over the same cell.
//  3. UNLIMITED. A preorder with an empty grid still takes 99 + 99.
//  4. IN STOCK UNCHANGED. A preorder item and a delivered item on an in-stock
//     cell are not counted; 2 sell, the 3rd is refused.
//  5. THE SWITCH. The same preorder items stop counting once the product is
//     switched to in stock (they were never part of the physical stock).
//
//   node tools/shop0209-preorder-limit.mjs                    # production
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN node tools/shop0209-preorder-limit.mjs
// RUN BEFORE 0209 AND IT FAILS AT "what counts: a delivered preorder" and
// "guard: then refuses the next".
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;

-- Since 0210 a preorder's numbers live in preorder_stock_matrix.
insert into public.shop_products (id, name, type, source, price, sizes, colors, stock_matrix, preorder_stock_matrix, is_active, stock_status, is_presale)
values
  ('probe0209p', 'probe0209p', 'apparel-shirt', 'md', 100, array['M'], '[]', '{}',              '{"M-default":2}', true, 'available', true),
  ('probe0209u', 'probe0209u', 'apparel-shirt', 'md', 100, array['M'], '[]', '{}',              '{}',              true, 'available', true),
  ('probe0209s', 'probe0209s', 'apparel-shirt', 'md', 100, array['M'], '[]', '{"M-default":2}', '{}',              true, 'available', false);

insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, placed_at, updated_at, timeline)
values ('ZZ0209D', null, 'paid',   100, 0, 100, now(), now(), '[]'),   -- item delivered
       ('ZZ0209C', null, 'cancel', 500, 0, 500, now(), now(), '[]'),   -- cancelled
       ('ZZ0209S', null, 'paid',   600, 0, 600, now(), now(), '[]');   -- on the in-stock product
insert into public.shop_order_items (order_id, product_id, size, color, fit, qty, unit_price, is_preorder, item_status)
values ('ZZ0209D', 'probe0209p', 'M', 'default', 'unisex', 1, 100, true,  'done'),
       ('ZZ0209C', 'probe0209p', 'M', 'default', 'unisex', 5, 100, true,  'paid'),
       ('ZZ0209S', 'probe0209s', 'M', 'default', 'unisex', 5, 100, true,  'paid'),
       ('ZZ0209S', 'probe0209s', 'M', 'default', 'unisex', 1, 100, false, 'done');

insert into probe values ('what counts: a delivered preorder counts, a cancelled one does not', '1',
  coalesce(public.shop_reserved_matrix('probe0209p') ->> 'M-default', '0'));
insert into probe values ('what counts: the all-products copy agrees', '1',
  coalesce(public.shop_reserved_matrix_all() -> 'probe0209p' ->> 'M-default', '0'));
insert into probe values ('in stock: a preorder item and a delivered item are not counted', '0',
  coalesce(public.shop_reserved_matrix('probe0209s') ->> 'M-default', '0'));

create temporary table who as
select (select u.id from public.users u
         where u.role = 'user' and coalesce(array_length(u.permissions,1),0) = 0
           and coalesce(array_length(u.managed_permissions,1),0) = 0
         order by u.id limit 1) as buyer;
grant select on who to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', (select buyer from who), 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare
  place text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0209=w1200',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  r text;
begin
  insert into probe values ('subject: the buyer is not a shop admin', 'false', public.current_user_is_shop_admin()::text);

  -- PREORDER WITH A LIMIT: 2 − 1 delivered = 1.
  begin execute format(place, '[{"product_id":"probe0209p","size":"M","qty":1}]') into r;
        insert into probe values ('guard: the last preorder slot is sold', 'placed', 'placed');
  exception when others then insert into probe values ('guard: the last preorder slot is sold', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0209p","size":"M","qty":1}]') into r;
        insert into probe values ('guard: then refuses the next', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('guard: then refuses the next', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;

  -- PREORDER WITH AN EMPTY GRID: unlimited, as before.
  begin execute format(place, '[{"product_id":"probe0209u","size":"M","qty":99}]') into r;
        execute format(place, '[{"product_id":"probe0209u","size":"M","qty":99}]') into r;
        insert into probe values ('unlimited: an empty grid takes 99 + 99', 'placed', 'placed');
  exception when others then insert into probe values ('unlimited: an empty grid takes 99 + 99', 'placed', sqlerrm); end;

  -- IN STOCK, UNCHANGED: 2 in the grid, nothing counted, so 2 sell.
  begin execute format(place, '[{"product_id":"probe0209s","size":"M","qty":2}]') into r;
        insert into probe values ('in stock: 2 of 2 sell', 'placed', 'placed');
  exception when others then insert into probe values ('in stock: 2 of 2 sell', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0209s","size":"M","qty":1}]') into r;
        insert into probe values ('in stock: the 3rd is refused', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('in stock: the 3rd is refused', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;
end $$;
reset role;

insert into probe values ('display: the preorder cell now shows 0 left', '0',
  (2 - coalesce((public.shop_reserved_matrix('probe0209p') ->> 'M-default')::int, 0))::text);

-- THE SWITCH: preorder items were never physical stock.
update public.shop_products set is_presale = false where id = 'probe0209p';
insert into probe values ('switch: once in stock, its preorder items stop counting', '0',
  coalesce(public.shop_reserved_matrix('probe0209p') ->> 'M-default', '0'));

select k, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict from probe;
rollback;
`;

const out = await runSql(SQL, target);
const rows = JSON.parse(out);
let failed = 0;
for (const r of rows) {
  const ok = r.verdict === 'PASS';
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${r.k}: expected ${r.expected}, got ${r.got}`);
}
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
