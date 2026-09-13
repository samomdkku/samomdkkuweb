-- ============================================================
-- shop0150-buyer-contact.sql — what may a BUYER change on their own order?
--
-- BOTH DIRECTIONS, because both are silent when wrong. If the whitelist is too
-- narrow the buyer meets a refusal for a field the error message says they own
-- (that was the bug: `buyer_email` missing while the raise promised
-- "ข้อมูลติดต่อ"). If it is too wide they can rewrite the money — which is the
-- bug 0100 was written for, on this exact table.
--
-- Everything runs as the REAL buyer of a REAL order inside a transaction that is
-- rolled back. The subject is resolved from the data, never named: an order in a
-- buyer-editable status whose buyer still exists.
--
--   node tools/db-query.mjs tools/shop0150-buyer-contact.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- THE SUBJECT IS MANUFACTURED, and that is deliberate. All six real orders in
-- this database were placed by shop ADMINS (they are test orders), and
-- `shop_orders_self_update_guard` returns early for
-- `current_user_is_shop_admin()` — so a proof that picks a real order makes
-- every case "allowed", the DENY half goes vacuous, and the ALLOW half stops
-- testing the whitelist entirely. The first draft did exactly that and reported
-- that a buyer could set the total to 1. Its deny cases are the only reason it
-- was caught.
--
-- So: clone a real order onto a real NON-admin account, inside the transaction
-- that is rolled back anyway. `current_user_is_shop_admin()` is true for the
-- shop_admin/dev roles AND for anyone holding `samoshop` or `master` through
-- either permission column (0081/0111), so all of that is excluded.
create temporary table victim on commit drop as
select u.id as uid from public.users u
 where u.role not in ('shop_admin', 'dev')
   and not (coalesce(u.permissions, '{}')         && array['samoshop', 'master'])
   and not (coalesce(u.managed_permissions, '{}') && array['samoshop', 'master'])
 order by u.id
 limit 1;

-- ⛔ THIS COPIED A TEMPLATE ROW THAT NO LONGER EXISTS.
--
-- `to_jsonb((select o from shop_orders order by id limit 1))` is NULL when the
-- table is empty, `NULL || jsonb_build_object(...)` is NULL, and
-- jsonb_populate_record then builds a row of all nulls — so the proof ERRORED
-- with `null value in column "id"` and emitted ZERO assertions. Measured
-- 2026-09-13: shop_orders holds 0 rows. The template was borrowed geometry, and
-- it ran out.
--
-- Same defect as team0183 §22-24 in the same week: if the thing a proof needs
-- can run out, CREATE it.
--
-- ⚠️ AND `jsonb_populate_record` DOES NOT APPLY COLUMN DEFAULTS — a key absent
-- from the jsonb becomes NULL, it does not become `def=0`. So the floor below
-- must name EVERY not-null column, not only the three that lack a default;
-- supplying just those got as far as `null value in column "fee"`. The floor is
-- on the LEFT, so a real template row still wins (`||` is right-biased) and the
-- proof's own values override both.
insert into public.shop_orders
select * from jsonb_populate_record(null::public.shop_orders,
  jsonb_build_object('subtotal', 0, 'fee', 0, 'total', 0, 'timeline', '[]'::jsonb,
                     'slips', '[]'::jsonb, 'is_preorder', false,
                     'placed_at', now(), 'updated_at', now())
  || coalesce(to_jsonb((select o from public.shop_orders o order by o.id limit 1)), '{}'::jsonb)
  || jsonb_build_object(
       'id',       'PROOF-0150',
       'buyer_id', (select uid::text from victim),
       'status',   'pending'));

create temporary table subj on commit drop as
select o.id, o.buyer_id, o.buyer_email, o.buyer_phone, o.total
  from public.shop_orders o where o.id = 'PROOF-0150';

insert into probe select 'S1. a buyer-editable order by a NON-admin exists', '1',
  (select count(*)::text from subj);

-- And prove the exclusion held, rather than trusting the filter.
insert into probe select 'S2. the subject is NOT a shop admin', 'false',
  (select public.current_user_is_shop_admin()::text
     from (select set_config('request.jwt.claims',
             json_build_object('sub', (select buyer_id::text from subj),
                               'role', 'authenticated')::text, true)) _);

insert into probe select 'S3. the order really has a money value to protect', 'true',
  (select (total is not null)::text from subj);

-- Run one UPDATE as the buyer and report what happened. The exception is caught
-- inside its own subtransaction, so a refusal does not abort the whole proof —
-- an aborted script is silence, not a red line.
create or replace function pg_temp.as_buyer(p_sql text) returns text as $$
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select buyer_id::text from subj), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    return 'allowed';
  exception when others then
    execute 'reset role';
    return 'refused';
  end;
end $$ language plpgsql;

-- ── ALLOW: the two contact fields ───────────────────────────────────────────
insert into probe select 'A1. buyer may correct their EMAIL', 'allowed',
  pg_temp.as_buyer(format(
    'update public.shop_orders set buyer_email = %L where id = %L',
    'typo-fixed@example.com', (select id from subj)));

insert into probe select 'A2. and it actually landed', 'typo-fixed@example.com',
  (select buyer_email from public.shop_orders where id = (select id from subj));

insert into probe select 'A3. buyer may correct their PHONE', 'allowed',
  pg_temp.as_buyer(format(
    'update public.shop_orders set buyer_phone = %L where id = %L',
    '081-000-0000', (select id from subj)));

-- ── DENY: the money and the identity ────────────────────────────────────────
-- Without these an "allowed" above proves only that the trigger is not running.
insert into probe select 'D1. buyer may NOT change the total', 'refused',
  pg_temp.as_buyer(format(
    'update public.shop_orders set total = 1 where id = %L', (select id from subj)));

insert into probe select 'D2. buyer may NOT change buyer_name', 'refused',
  pg_temp.as_buyer(format(
    'update public.shop_orders set buyer_name = %L where id = %L',
    'somebody else', (select id from subj)));

insert into probe select 'D3. buyer may NOT reassign the order', 'refused',
  pg_temp.as_buyer(format(
    'update public.shop_orders set buyer_id = %L where id = %L',
    '00000000-0000-0000-0000-000000000000', (select id from subj)));

insert into probe select 'D4. the total is untouched after all of it',
  (select s.total::text from subj s limit 1),
  (select total::text from public.shop_orders where id = (select id from subj));

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as result
from probe order by step;

rollback;
