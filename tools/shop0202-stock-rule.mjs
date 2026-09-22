#!/usr/bin/env node
// ============================================================
// shop0202-stock-rule.mjs — what the storefront shows as LEFT agrees with what
//                           the order guard will SELL, and a colour the product
//                           does not offer is refused.
//
// One transaction that ROLLS BACK. Two products only this proof uses:
//   probe0202c — colours [black], size M, stock M-black = 2
//   probe0202n — no colours, size M, no stock numbers
//
//  1. DISPLAY vs GUARD. A preorder item (frozen is_preorder = true) on the
//     stocked cell must NOT count as reserved — the guard never counted it;
//     before 0202 the display did (0040 lost 0038's filter). Then the guard and
//     the display are read over the SAME rows: after one real order the display
//     says 1 left and the guard sells exactly 1 more, then refuses.
//  2. COLOUR. ALLOW the offered colour / 'default' on a colourless product;
//     DENY an unknown colour, 'default' on a coloured product, and a colour on a
//     colourless one — each DENY beside an ALLOW over the same product.
//  3. SLIP / QTY / LINES. A buyer order needs a slip and a Google slip URL;
//     99 is the most per line; two lines for one cell count against its stock
//     TOGETHER (2 + 1 of 2 refused, 1 + 1 placed).
//  4. SELF-UPDATE. The buyer's add-slip and remove-slip writes still pass; a
//     buyer-set slip_mismatch, a forged {stage:'paid'} entry and a non-Google
//     slip URL are refused.
//
//   node tools/shop0202-stock-rule.mjs                    # production
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN node tools/shop0202-stock-rule.mjs
// RUN BEFORE 0202 AND IT FAILS AT "display:" and the three colour DENY rows.
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;

insert into public.shop_products (id, name, type, source, price, sizes, colors, stock_matrix, is_active, stock_status, is_presale)
values
  ('probe0202c', 'probe0202c', 'apparel-shirt', 'md', 100, array['M'], '[{"id":"black","label":"ดำ","hex":"#000"}]', '{"M-black":2}', true, 'available', false),
  ('probe0202n', 'probe0202n', 'apparel-shirt', 'md', 100, array['M'], '[]', '{}', true, 'available', false);

-- A preorder item on the stocked cell, from before the product switched to stock.
insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, placed_at, updated_at, timeline)
values ('ZZ0202', null, 'paid', 500, 0, 500, now(), now(), '[]');
insert into public.shop_order_items (order_id, product_id, size, color, fit, qty, unit_price, is_preorder, item_status)
values ('ZZ0202', 'probe0202c', 'M', 'black', 'unisex', 5, 100, true, 'paid');

insert into probe values ('display: a preorder item does not reserve stock', '0',
  coalesce((public.shop_reserved_matrix('probe0202c') ->> 'M-black'), '0'));
insert into probe values ('display: the all-products copy agrees', '0',
  coalesce((public.shop_reserved_matrix_all() -> 'probe0202c' ->> 'M-black'), '0'));

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
  place text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0202=w1200',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  noslip text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  badslip text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://evil.example/x"onerror="1',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  one text := '[{"product_id":"probe0202n","size":"M","qty":1}]';
  r text;
begin
  insert into probe values ('subject: the buyer is not a shop admin', 'false', public.current_user_is_shop_admin()::text);

  -- COLOUR — ALLOW, then each DENY.
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"black","qty":1}]') into r;
        insert into probe values ('colour: the offered colour is sold', 'placed', 'placed');
  exception when others then insert into probe values ('colour: the offered colour is sold', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"zzz","qty":1}]') into r;
        insert into probe values ('colour: an unknown colour is refused', 'COLOR_UNAVAILABLE', 'ACCEPTED');
  exception when others then insert into probe values ('colour: an unknown colour is refused', 'COLOR_UNAVAILABLE', split_part(sqlerrm, ':', 1)); end;
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","qty":1}]') into r;
        insert into probe values ('colour: no colour on a coloured product is refused', 'COLOR_UNAVAILABLE', 'ACCEPTED');
  exception when others then insert into probe values ('colour: no colour on a coloured product is refused', 'COLOR_UNAVAILABLE', split_part(sqlerrm, ':', 1)); end;
  begin execute format(place, '[{"product_id":"probe0202n","size":"M","qty":1}]') into r;
        insert into probe values ('colour: a colourless product sells as default', 'placed', 'placed');
  exception when others then insert into probe values ('colour: a colourless product sells as default', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0202n","size":"M","color":"black","qty":1}]') into r;
        insert into probe values ('colour: a colour on a colourless product is refused', 'COLOR_UNAVAILABLE', 'ACCEPTED');
  exception when others then insert into probe values ('colour: a colour on a colourless product is refused', 'COLOR_UNAVAILABLE', split_part(sqlerrm, ':', 1)); end;

  -- DISPLAY vs GUARD over the same rows: 2 in stock, 1 sold above.
  insert into probe values ('agree: the display says 1 left', '1',
    (2 - coalesce((public.shop_reserved_matrix('probe0202c') ->> 'M-black')::int, 0))::text);
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"black","qty":1}]') into r;
        insert into probe values ('agree: the guard sells that 1', 'placed', 'placed');
  exception when others then insert into probe values ('agree: the guard sells that 1', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"black","qty":1}]') into r;
        insert into probe values ('agree: then refuses the next', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('agree: then refuses the next', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;

  -- SLIP: required, and only a Google-hosted URL. ALLOW is every 'placed' above.
  begin execute format(noslip, one) into r;
        insert into probe values ('slip: a buyer order without a slip is refused', 'NO_SLIP', 'ACCEPTED');
  exception when others then insert into probe values ('slip: a buyer order without a slip is refused', 'NO_SLIP', split_part(sqlerrm, ':', 1)); end;
  begin execute format(badslip, one) into r;
        insert into probe values ('slip: a non-Google slip URL is refused', 'BAD_SLIP_URL', 'ACCEPTED');
  exception when others then insert into probe values ('slip: a non-Google slip URL is refused', 'BAD_SLIP_URL', split_part(sqlerrm, ':', 1)); end;

  -- QTY: 99 is the ceiling (ALLOW 99 on the untracked product, DENY 100).
  begin execute format(place, '[{"product_id":"probe0202n","size":"M","qty":99}]') into r;
        insert into probe values ('qty: 99 is allowed', 'placed', 'placed');
  exception when others then insert into probe values ('qty: 99 is allowed', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0202n","size":"M","qty":100}]') into r;
        insert into probe values ('qty: 100 is refused', 'INVALID_QTY', 'ACCEPTED');
  exception when others then insert into probe values ('qty: 100 is refused', 'INVALID_QTY', split_part(sqlerrm, ':', 1)); end;
end $$;
reset role;

-- LINES OF ONE CALL COUNT TOGETHER: a fresh cell with 2 in stock.
update public.shop_products set stock_matrix = '{"M-black":2}' where id = 'probe0202c';
delete from public.shop_order_items where product_id = 'probe0202c';
set local role authenticated;
do $$
declare
  place text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0202=w1200',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  r text;
begin
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"black","qty":2,"fit":"a"},{"product_id":"probe0202c","size":"M","color":"black","qty":1,"fit":"b"}]') into r;
        insert into probe values ('lines: 2 + 1 of a cell holding 2 is refused', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('lines: 2 + 1 of a cell holding 2 is refused', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;
  begin execute format(place, '[{"product_id":"probe0202c","size":"M","color":"black","qty":1,"fit":"a"},{"product_id":"probe0202c","size":"M","color":"black","qty":1,"fit":"b"}]') into r;
        insert into probe values ('lines: 1 + 1 of a cell holding 2 is placed', 'placed', 'placed');
  exception when others then insert into probe values ('lines: 1 + 1 of a cell holding 2 is placed', 'placed', sqlerrm); end;
end $$;
reset role;

-- THE BUYER'S OWN ORDER: what the self-update guard lets through.
create temporary table mine as
select id from public.shop_orders where buyer_id = (select buyer from who) and status = 'review' order by id limit 1;
grant select on mine to authenticated;
set local role authenticated;
do $$
declare v_id text := (select id from mine); good text := 'https://lh3.googleusercontent.com/d/probe0202b=w1200';
begin
  -- ALLOW: the add-slip flow — a Google slip, status review, a 'review' entry.
  begin
    update public.shop_orders set slips = slips || jsonb_build_array(jsonb_build_object('url', good, 'at', now())),
      slip_url = good, status = 'review',
      timeline = timeline || jsonb_build_array(jsonb_build_object('stage','review','at',now(),'label','x'))
      where id = v_id;
    insert into probe values ('self: adding a Google slip is allowed', 'allowed', case when found then 'allowed' else 'no row' end);
  exception when others then insert into probe values ('self: adding a Google slip is allowed', 'allowed', sqlerrm); end;
  -- ALLOW: removing it — back to pending.
  begin
    update public.shop_orders set status = 'pending',
      timeline = timeline || jsonb_build_array(jsonb_build_object('stage','pending','at',now(),'label','x'))
      where id = v_id;
    insert into probe values ('self: back to pending is allowed', 'allowed', case when found then 'allowed' else 'no row' end);
  exception when others then insert into probe values ('self: back to pending is allowed', 'allowed', sqlerrm); end;
  begin
    update public.shop_orders set status = 'slip_mismatch' where id = v_id;
    insert into probe values ('self: setting slip_mismatch is refused', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('self: setting slip_mismatch is refused', 'refused', 'refused'); end;
  begin
    update public.shop_orders set timeline = timeline || jsonb_build_array(jsonb_build_object('stage','paid','at',now(),'label','ชำระเงินแล้ว'))
      where id = v_id;
    insert into probe values ('self: a forged paid timeline entry is refused', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('self: a forged paid timeline entry is refused', 'refused', 'refused'); end;
  begin
    -- Built with jsonb_build_object, not a hand-escaped literal: an escaping
    -- slip made invalid JSON, refused for the WRONG reason (green pre-fix).
    update public.shop_orders set slips = slips || jsonb_build_array(jsonb_build_object(
      'url', 'https://x/' || chr(34) || 'onerror=' || chr(34) || '1', 'at', now())) where id = v_id;
    insert into probe values ('self: a non-Google slip URL is refused', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('self: a non-Google slip URL is refused', 'refused', 'refused'); end;
end $$;
reset role;

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
