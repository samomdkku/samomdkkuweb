#!/usr/bin/env node
// ============================================================
// shop0206-totals.mjs — the numbers the shop's Discord message quotes.
//
// One transaction that ROLLS BACK. What it asks of the LIVE database:
//  1. ACL, read from pg_proc (never the revoke we wrote): only service_role
//     may execute; anon and authenticated may not.
//  2. NUMBERS: seeded orders move each total by exactly what the admin
//     dashboard's rule says — the ALLOW beside the DENY is a 'cancel' and a
//     'slip_mismatch' that must NOT count as revenue.
//  3. INVOKER: run as a real signed-in student with the grant forced open, it
//     totals only what RLS shows that student — not the shop.
//
//   node tools/shop0206-totals.mjs                    # production
// RUN BEFORE 0206 AND IT ERRORS (no function).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const SQL = `begin;
create temporary table probe(k text, expected text, got text);

-- 1. ACL
insert into probe values ('acl: service_role can execute', 'true',
  has_function_privilege('service_role', 'public.shop_order_totals()', 'execute')::text);
insert into probe values ('acl: authenticated cannot', 'false',
  has_function_privilege('authenticated', 'public.shop_order_totals()', 'execute')::text);
insert into probe values ('acl: anon cannot', 'false',
  has_function_privilege('anon', 'public.shop_order_totals()', 'execute')::text);

-- 2. NUMBERS — delta from a seed of five orders, one per class
create temporary table b as select public.shop_order_totals() t;
insert into public.shop_orders (id, buyer_label, status, subtotal, fee, total) values
  ('PRB0206A', 'probe', 'review',        100, 0, 100),
  ('PRB0206B', 'probe', 'paid',           20, 0,  20),
  ('PRB0206C', 'probe', 'pending',         3, 0,   3),
  ('PRB0206D', 'probe', 'slip_mismatch', 4000, 0, 4000),
  ('PRB0206E', 'probe', 'cancel',      50000, 0, 50000);
create temporary table a as select public.shop_order_totals() t;
insert into probe select 'numbers: awaiting_review +1 (review only)', '1',
  ((a.t->>'awaiting_review')::int - (b.t->>'awaiting_review')::int)::text from a, b;
insert into probe select 'numbers: orders +4 (cancel excluded)', '4',
  ((a.t->>'orders')::int - (b.t->>'orders')::int)::text from a, b;
insert into probe select 'numbers: orders_total +4123 (cancel excluded)', '4123',
  ((a.t->>'orders_total')::numeric - (b.t->>'orders_total')::numeric)::text from a, b;
insert into probe select 'numbers: revenue +20 (only the checked slip)', '20',
  ((a.t->>'revenue')::numeric - (b.t->>'revenue')::numeric)::text from a, b;

-- 3. INVOKER — force the grant open inside this transaction, run as a student
--    with no orders: RLS must leave them nothing to total.
grant execute on function public.shop_order_totals() to authenticated;
create temporary table stu as
select u.id from public.users u
 where u.role = 'user' and not ('samoshop' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
   and not exists (select 1 from public.shop_orders o where o.buyer_id = u.id)
 order by u.id limit 1;
do $$ begin
  execute format('grant usage on schema %s to authenticated', pg_my_temp_schema()::regnamespace);
end $$;
grant select, insert on stu, probe to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from stu), 'role','authenticated')::text, true);
set local role authenticated;
insert into probe values ('subject: the student is not a shop admin', 'false', public.current_user_is_shop_admin()::text);
insert into probe values ('invoker: a student totals only their own (none)', '0',
  (public.shop_order_totals()->>'orders'));
reset role;
insert into probe select 'invoker: …while the shop has orders (the allow)', 'true',
  ((a.t->>'orders')::int > 0)::text from a;

select k, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict from probe;
rollback;
`;

const rows = JSON.parse(await runSql(SQL, target));
let failed = 0;
for (const r of rows) {
  const ok = r.verdict === 'PASS';
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${r.k}: expected ${r.expected}, got ${r.got}`);
}
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
