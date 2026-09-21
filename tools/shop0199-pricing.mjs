#!/usr/bin/env node
// ============================================================
// shop0199-pricing.mjs — the database charges the price, per size, and only a
//                         signed-in buyer may order, as themselves.
//
// Two halves, one transaction that ROLLS BACK:
//
//  1. THE RULE. Every case in src/js/shop/price-cases.json is replayed against
//     public.shop_unit_price(). data.test.js replays the SAME file against the
//     JS mirror unitPriceFor(), so the page's number and the order's number
//     cannot drift without one side going red.
//
//  2. THE DOORS, measured open on production before 0199:
//       anon  → place_shop_order(<someone else>, unit_price 0)   was ACCEPTED
//       buyer → insert into shop_orders (status 'paid')           was ACCEPTED
//     Each DENY is paired with an ALLOW over the same product, so a broken RPC
//     cannot pass as a working guard — and a shop admin keeps the hand-typed
//     price adminCreateOrder depends on.
//
//   node tools/shop0199-pricing.mjs                    # production
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN node tools/shop0199-pricing.mjs
// RUN BEFORE 0199 AND IT FAILS AT "rule:" (no function) — every row after it.
// ============================================================
import { readFileSync } from 'node:fs';
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const { cases } = JSON.parse(readFileSync(new URL('../src/js/shop/price-cases.json', import.meta.url), 'utf8'));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const ruleRows = cases.map((c) => `
insert into probe select ${lit('rule: ' + c.name)}, ${lit(c.expect)},
  public.shop_unit_price(jsonb_populate_record(null::public.shop_products, ${lit(JSON.stringify(c.product))}::jsonb), ${lit(c.size)})::text;`).join('');

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;
${ruleRows}

-- A product only this proof uses. XL costs more than the base.
insert into public.shop_products (id, name, type, source, price, sizes, is_active, stock_status, is_presale, price_by_size)
values ('probe0199', 'probe0199', 'apparel-shirt', 'md', 250, array['S','M','XL'], true, 'available', false, '{"XL":290}');

-- A BUYER: an ordinary account, and SOMEONE ELSE to impersonate.
create temporary table who as
select (select u.id from public.users u
         where u.role = 'user' and coalesce(array_length(u.permissions,1),0) = 0
           and coalesce(array_length(u.managed_permissions,1),0) = 0
         order by u.id limit 1) as buyer,
       (select u.id from public.users u where u.role = 'user' order by u.id desc limit 1) as other;
grant select on who to authenticated, anon;

select set_config('request.jwt.claims', json_build_object('sub', (select buyer from who), 'role','authenticated')::text, true);
set local role authenticated;
do $$ declare v_id text; v_total int; v_fee int; v_price int; begin
  insert into probe values ('subject: the buyer is not a shop admin', 'false', public.current_user_is_shop_admin()::text);
  -- ALLOW: own order, but the SENT price (1) and fee (50) are ignored.
  begin
    v_id := public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','',null,'[]'::jsonb,
      '[{"product_id":"probe0199","size":"XL","qty":2,"unit_price":1}]'::jsonb, 50);
    select total, fee into v_total, v_fee from public.shop_orders where id = v_id;
    select unit_price into v_price from public.shop_order_items where order_id = v_id;
    insert into probe values ('buyer: own order is placed', 'placed', 'placed');
    insert into probe values ('buyer: charged the XL price, not the one sent', '290', v_price::text);
    insert into probe values ('buyer: total is 2 × 290 and the fee is 0', '580/0', v_total || '/' || v_fee);
  exception when others then insert into probe values ('buyer: own order is placed', 'placed', sqlerrm); end;
  -- DENY: ordering in someone else's name.
  begin
    perform public.place_shop_order((select other from who), 'p','p','p@x','0','','','',null,'[]'::jsonb,
      '[{"product_id":"probe0199","size":"M","qty":1,"unit_price":0}]'::jsonb, 0);
    insert into probe values ('buyer: cannot order as someone else', 'NOT_YOUR_ORDER', 'ACCEPTED');
  exception when others then insert into probe values ('buyer: cannot order as someone else', 'NOT_YOUR_ORDER', sqlerrm); end;
  -- DENY: a size the product does not have (it would fall back to the base price).
  begin
    perform public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','',null,'[]'::jsonb,
      '[{"product_id":"probe0199","size":"ZZ","qty":1}]'::jsonb, 0);
    insert into probe values ('buyer: an unknown size is refused', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('buyer: an unknown size is refused', 'refused',
    case when sqlerrm like 'SIZE_UNAVAILABLE%' then 'refused' else sqlerrm end); end;
  -- DENY: writing an order row directly, already 'paid'.
  begin
    insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, placed_at, updated_at, timeline)
    values ('ZZ0199', auth.uid(), 'paid', 0, 0, 0, now(), now(), '[]');
    insert into probe values ('buyer: cannot insert an order row directly', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('buyer: cannot insert an order row directly', 'refused', 'refused'); end;
end $$;
reset role;

-- DENY: anonymous.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin
    perform public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','',null,'[]'::jsonb,
      '[{"product_id":"probe0199","size":"M","qty":1,"unit_price":0}]'::jsonb, 0);
    insert into probe values ('anon: cannot place an order', 'refused', 'ACCEPTED');
  exception when others then insert into probe values ('anon: cannot place an order', 'refused', 'refused'); end;
end $$;
reset role;

-- ALLOW: a shop admin still places a walk-in order at a hand-typed price.
create temporary table adm as
select u.id from public.users u
 where u.role = 'dev' or 'samoshop' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
 order by u.id limit 1;
grant select on adm to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from adm), 'role','authenticated')::text, true);
set local role authenticated;
do $$ declare v_id text; begin
  insert into probe values ('subject: the admin is a shop admin', 'true', public.current_user_is_shop_admin()::text);
  begin
    v_id := public.place_shop_order(null, 'walk-in','walk-in',null,null,null,null,null,null,'[]'::jsonb,
      '[{"product_id":"probe0199","size":"XL","qty":1,"unit_price":123}]'::jsonb, 0);
    insert into probe values ('admin: a walk-in order keeps the typed price', '123',
      (select total::text from public.shop_orders where id = v_id));
  exception when others then insert into probe values ('admin: a walk-in order keeps the typed price', '123', sqlerrm); end;
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
