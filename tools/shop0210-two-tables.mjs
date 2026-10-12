#!/usr/bin/env node
// ============================================================
// shop0210-two-tables.mjs — preorder and in-stock each have their OWN numbers,
//                           and the Preorder tick decides which one the order
//                           guard enforces.
//
// One transaction that ROLLS BACK. Products only this proof uses:
//   probe0210  — PREORDER, size M, in-stock table M = 5, preorder table M = 1
//   probe0210n — PREORDER, size M, in-stock table M = 1, preorder table EMPTY
//
//  1. THE DATA MOVE. No preorder product is left with numbers in its in-stock
//     table and an empty preorder table (0210 moved them).
//  2. PICKING. shop_active_stock answers the preorder table while ticked and
//     the in-stock table once unticked.
//  3. PREORDER MODE. The preorder table's 1 sells, then refuses — the
//     in-stock 5 beside it is ignored (ALLOW + DENY over the same cell).
//  4. AN EMPTY PREORDER TABLE IS UNLIMITED, even with in-stock numbers set.
//  5. SWITCHING. Untick Preorder: the in-stock table's 5 sell and the 6th is
//     refused — the preorder item sold in step 3 does not eat into it.
//
//   node tools/shop0210-two-tables.mjs                    # production
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN node tools/shop0210-two-tables.mjs
// RUN BEFORE 0210 AND IT ERRORS: the preorder_stock_matrix column does not exist.
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;

insert into probe values ('data: no preorder product keeps its numbers only in the in-stock table', '0',
  (select count(*)::text from public.shop_products
    where is_presale and stock_matrix <> '{}'::jsonb and preorder_stock_matrix = '{}'::jsonb));

insert into public.shop_products (id, name, type, source, price, sizes, colors, stock_matrix, preorder_stock_matrix, is_active, stock_status, is_presale)
values
  ('probe0210',  'probe0210',  'apparel-shirt', 'md', 100, array['M'], '[]', '{"M-default":5}', '{"M-default":1}', true, 'available', true),
  ('probe0210n', 'probe0210n', 'apparel-shirt', 'md', 100, array['M'], '[]', '{"M-default":1}', '{}',              true, 'available', true);

insert into probe values ('pick: a preorder uses the preorder table', '1',
  (select public.shop_active_stock(p) ->> 'M-default' from public.shop_products p where id = 'probe0210'));

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
  place text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0210=w1200',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  r text;
begin
  insert into probe values ('subject: the buyer is not a shop admin', 'false', public.current_user_is_shop_admin()::text);
  begin execute format(place, '[{"product_id":"probe0210","size":"M","qty":1}]') into r;
        insert into probe values ('preorder: the preorder table''s 1 sells', 'placed', 'placed');
  exception when others then insert into probe values ('preorder: the preorder table''s 1 sells', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0210","size":"M","qty":1}]') into r;
        insert into probe values ('preorder: then refuses, the in-stock 5 ignored', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('preorder: then refuses, the in-stock 5 ignored', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;
  begin execute format(place, '[{"product_id":"probe0210n","size":"M","qty":3}]') into r;
        insert into probe values ('unlimited: an empty preorder table ignores in-stock numbers', 'placed', 'placed');
  exception when others then insert into probe values ('unlimited: an empty preorder table ignores in-stock numbers', 'placed', sqlerrm); end;
end $$;
reset role;

update public.shop_products set is_presale = false where id = 'probe0210';
insert into probe values ('pick: unticked, the in-stock table', '5',
  (select public.shop_active_stock(p) ->> 'M-default' from public.shop_products p where id = 'probe0210'));

set local role authenticated;
do $$
declare
  place text := $q$select public.place_shop_order((select buyer from who), 'p','p','p@x','0','','','https://lh3.googleusercontent.com/d/probe0210=w1200',null,'[]'::jsonb, %L::jsonb, 0)$q$;
  r text;
begin
  begin execute format(place, '[{"product_id":"probe0210","size":"M","qty":5}]') into r;
        insert into probe values ('switch: the in-stock 5 sell', 'placed', 'placed');
  exception when others then insert into probe values ('switch: the in-stock 5 sell', 'placed', sqlerrm); end;
  begin execute format(place, '[{"product_id":"probe0210","size":"M","qty":1}]') into r;
        insert into probe values ('switch: the 6th is refused', 'OUT_OF_STOCK', 'ACCEPTED');
  exception when others then insert into probe values ('switch: the 6th is refused', 'OUT_OF_STOCK', split_part(sqlerrm, ':', 1)); end;
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
