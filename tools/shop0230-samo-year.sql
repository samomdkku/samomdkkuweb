-- ============================================================
-- shop0230-samo-year.sql — shop_orders.samo_year_be (0230):
--   §0  structural: the column, its index and its INSERT trigger exist
--   §A  an order inserted with no samo_year_be gets current_samo_year(),
--       through the SAME insert-time stamping as every other system (0219)
--   §B  an explicit samo_year_be at insert is NOT overwritten by the trigger
--   §C  THE BACKFILL EXPRESSION, run against a REAL handover: an order
--       stamped while a sentinel term was current keeps resolving to THAT
--       term from its stored `placed_at` even after a later handover makes
--       a DIFFERENT term current — proving the backfill reads history, not
--       wall-clock "now"
--   §C2 an UNPAID order does NOT move to the new year at handover — it was
--       never going to (nothing re-stamps on UPDATE); the design doc's own
--       named edge case ("ค้างจากปีก่อน"), proven directly
--   §D  RLS is UNCHANGED by this column — year is a FILTER, not an access
--       boundary: a buyer still reads their own order from a past sentinel
--       year (ALLOW), a stranger still cannot read it (DENY), and shop
--       admin still reads every year (ALLOW)
--   §E  shop_order_totals() (0206, recreated by 0230) tracks the LIVE
--       current year, not a hardcoded one, and a past-year order's presence
--       does not leak into the new year's totals — proven by SNAPSHOT
--       DELTAS, never an absolute count, so this proof holds regardless of
--       how many real orders already exist on whatever database runs it
--   §F  if current_samo_year() is ever NULL (no is_current row — should not
--       happen once a team exists, but this function must not go
--       near-silent the one time it does), shop_order_totals() falls back
--       to counting EVERYTHING, same as the original 0206 behaviour
--
-- Insert path: shop admin direct insert (shop_orders_insert_admin, 0035) —
-- buyers have had NO direct INSERT on shop_orders since 0199
-- (shop-price-is-server-side); the admin walk-in path is also the one place
-- this migration's own header flags as able to disagree with placed_at, so
-- it is the right path to drive this proof through.
--
-- Sentinel years 2695/2696 — distinct from year0219 (2691/2692), pr0220
-- (2693/2694) and vs0221/proj0223's own ranges; everything rolls back, so a
-- collision only matters within a single run, never across them.
--   node tools/db-query.mjs tools/shop0230-samo-year.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
create temporary table snap (label text primary key, totals jsonb) on commit drop;
create or replace function pg_temp.take_snap(p_label text) returns void language sql as $$
  insert into snap values (p_label, public.shop_order_totals())
$$;
-- delta of one numeric key between two snapshots
create or replace function pg_temp.delta(p_from text, p_to text, p_key text) returns numeric language sql as $$
  select (select totals->>p_key from snap where label = p_to)::numeric
       - (select totals->>p_key from snap where label = p_from)::numeric
$$;

-- ── §0 structural ────────────────────────────────────────────────────────
insert into probe select '00. shop_orders.samo_year_be exists, smallint', '1',
  (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_orders'
      and column_name = 'samo_year_be' and data_type = 'smallint');

insert into probe select '01. an index on samo_year_be exists', 'true',
  (select (count(*) > 0)::text from pg_indexes
    where schemaname = 'public' and tablename = 'shop_orders'
      and indexdef ilike '%samo_year_be%');

insert into probe select '02. a trigger on shop_orders calls samo_year_be_default() (fires BEFORE INSERT — proven behaviourally in §A/§B)', 'true',
  (select (count(*) > 0)::text from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.shop_orders'::regclass
      and p.proname = 'samo_year_be_default');

-- ── principal: shop admin AND team-handover capable, one credential ────────
-- §C needs to call start_team_term (role vp_admin/dev or permission
-- team_edit) from the SAME account §A/§B/§D/§E use for shop admin reads
-- (current_user_is_shop_admin(): role shop_admin/dev or permission
-- samoshop) — 'dev' alone satisfies BOTH checks, same shape pr0220 uses.
create temporary table admin_all on commit drop as
select u.id, lower(btrim(u.email)) as email from public.users u
 where u.role = 'dev'
 order by u.id limit 1;

set local session_replication_role = replica;
insert into admin_all
select u.id, lower(btrim(u.email))
  from public.users u
 where not exists (select 1 from admin_all)
   and u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
 order by u.id limit 1;
update public.users set role = 'dev'
 where id = (select id from admin_all) and role <> 'dev'
   and exists (select 1 from admin_all);
set local session_replication_role = origin;

insert into probe select '03. a shop admin exists (made here if none did)', '1',
  (select count(*)::text from admin_all);

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', id, 'role', 'authenticated', 'email', email)::text from admin_all), true);
$$;
create or replace function pg_temp.as_stranger() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated',
                      'email', 'nobody-0230@kkumail.com')::text, true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated;

-- An ordinary buyer — no shop admin / dev channel at all.
create temporary table subj_buyer on commit drop as
select u.id as uid from public.users u
 where u.role not in ('shop_admin', 'dev')
   and not ('samoshop' = any(coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
   and u.id not in (select id from admin_all)
 order by u.id limit 1;
insert into probe select '04. an ordinary buyer (no samoshop/dev) exists', '1',
  (select count(*)::text from subj_buyer);
grant select on subj_buyer to authenticated;

create or replace function pg_temp.as_buyer() returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', uid, 'role', 'authenticated', 'email', 'buyer-0230@kkumail.com')::text from subj_buyer), true);
$$;

create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated;

delete from public.team_terms where year in (2695, 2696);
select pg_temp.take_snap('t0_before_anything');

-- ── §A no explicit year → stamped from current_samo_year() ─────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_a',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total)
               values ('SH-TEST0230A', (select uid from subj_buyer), 'pending', 100, 0, 100)$q$);
reset role;
insert into probe select '10. admin insert with no samo_year_be succeeds', 'ok', (select v from r where k = 'ins_a');
insert into probe select '11. …and it was stamped with current_samo_year()',
  (select public.current_samo_year()::text),
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230A');
select pg_temp.take_snap('t1_after_a');
-- 'pending' is not revenue, but it IS counted in orders_total (status <> cancel).
insert into probe select '12. orders_total rose by exactly 100 — a pending order under the CURRENT year counts', '100',
  pg_temp.delta('t0_before_anything', 't1_after_a', 'orders_total')::text;
insert into probe select '13. revenue did NOT rise — pending is not yet money', '0',
  pg_temp.delta('t0_before_anything', 't1_after_a', 'revenue')::text;

-- ── §B an explicit year at INSERT is kept, not overwritten ──────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_b',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, samo_year_be)
               values ('SH-TEST0230B', (select uid from subj_buyer), 'pending', 100, 0, 100, 2555)$q$);
reset role;
insert into probe select '20. insert WITH an explicit samo_year_be succeeds', 'ok', (select v from r where k = 'ins_b');
insert into probe select '21. …and the trigger left it alone', '2555',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230B');
select pg_temp.take_snap('t2_after_b');
insert into probe select '22. orders_total did NOT rise again — year 2555 is not the CURRENT year', '0',
  pg_temp.delta('t1_after_a', 't2_after_b', 'orders_total')::text;

-- ── §C the backfill expression, across a REAL handover ──────────────────────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2695', pg_temp.try('select public.start_team_term(2695)');
reset role;
insert into probe select '30. sentinel term 2695 opens', 'ok', (select v from r where k = 'start_2695');

-- now() is frozen for this transaction's lifetime — backdate 2695's
-- started_at directly (the same supported admin override every column in
-- this design has) so the two handovers below land at genuinely different
-- instants, which a real rollover days apart would have for free.
-- ⛔ MINUTES, NOT DAYS, and the term start_team_term just closed is closed at
-- the SAME instant. This used to be `now() - 2 days`, which only worked while
-- every real term on the project had started more than two days ago: samo-dev
-- had 2571 started 2026-10-18 17:41, so on 10-20 an order "placed a day ago"
-- sat inside BOTH 2571 and 2695 and step 39 read 2571 — red for a reason that
-- had nothing to do with 0230 (a scenario needing geometry that runs out,
-- docs/mistakes/tooling-proofs.md). Two minutes cannot collide with any real
-- term, because real terms do not start inside this transaction.
update public.team_terms set ended_at = now() - interval '2 minutes'
 where year <> 2695 and ended_at = now();
update public.team_terms set started_at = now() - interval '2 minutes' where year = 2695;
select pg_temp.take_snap('t3_after_2695_opens');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_hist',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, placed_at)
               values ('SH-TEST0230C', (select uid from subj_buyer), 'paid', 100, 0, 100, now() - interval '1 minute')$q$);
reset role;
insert into probe select '31. an order placed while 2695 is current is stamped 2695 (the trigger reads the LIVE term, not placed_at)', '2695',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230C');
select pg_temp.take_snap('t4_after_c');
insert into probe select '32. revenue rose by exactly 100 while 2695 IS current — the scope tracks the LIVE year, not a hardcoded one', '100',
  pg_temp.delta('t3_after_2695_opens', 't4_after_c', 'revenue')::text;

-- §C2 — the design doc's own edge case: an UNPAID order stays open across
-- the handover and keeps its original year (nothing re-stamps on UPDATE).
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_unpaid',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total, placed_at)
               values ('SH-TEST0230C2', (select uid from subj_buyer), 'review', 100, 0, 100, now() - interval '1 minute')$q$);
reset role;
insert into probe select '33. an UNPAID order placed while 2695 is current is also stamped 2695', '2695',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230C2');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'start_2696', pg_temp.try('select public.start_team_term(2696)');
reset role;
insert into probe select '34. handover to 2696 succeeds — 2695 is now history', 'ok', (select v from r where k = 'start_2696');
insert into probe select '35. current_samo_year() now answers 2696', '2696', (select public.current_samo_year()::text);
insert into probe select '36. the still-UNPAID order (review) did NOT move to 2696 — it stays "ค้างจากปีก่อน"', '2695',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230C2');
select pg_temp.take_snap('t5_after_2696_opens');
insert into probe select '37. …and the switch to 2696 made orders_total/revenue DROP BACK exactly to baseline — none of A/B/C/C2 (all pre-2696) leak into the new year', 'ok',
  (case when pg_temp.delta('t0_before_anything', 't5_after_2696_opens', 'orders_total') = 0
         and pg_temp.delta('t0_before_anything', 't5_after_2696_opens', 'revenue') = 0
        then 'ok' else 'FAIL: '
          || pg_temp.delta('t0_before_anything', 't5_after_2696_opens', 'orders_total')::text || ' / '
          || pg_temp.delta('t0_before_anything', 't5_after_2696_opens', 'revenue')::text end);

-- Simulate "never backfilled" (what every one of the 50 real rows looked
-- like before this migration's own backfill ran), then run the EXACT
-- expression the migration uses — after the handover, so "now" would give
-- the wrong answer if the backfill secretly used it instead of history.
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'clear_hist', pg_temp.try($q$update public.shop_orders set samo_year_be = null where id = 'SH-TEST0230C'$q$);
reset role;
insert into probe select '38. clearing samo_year_be for the backfill test succeeds', 'ok', (select v from r where k = 'clear_hist');

update public.shop_orders
   set samo_year_be = public.samo_year_for_timestamp(placed_at)
 where id = 'SH-TEST0230C' and samo_year_be is null;
insert into probe select '39. the backfill resolves it to 2695 (when it REALLY happened), not 2696 (now)', '2695',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230C');

-- ── §D RLS is unchanged: year is a filter, never an access boundary ─────────
select pg_temp.as_stranger();
set local role authenticated;
insert into r select 'deny_stranger', pg_temp.try($q$select 1/count(*) from public.shop_orders where id = 'SH-TEST0230C'$q$);
reset role;
insert into probe select '40. a stranger cannot read the past-year order', 'true',
  (select (v like 'raised%')::text from r where k = 'deny_stranger');

select pg_temp.as_buyer();
set local role authenticated;
insert into r select 'allow_mine', pg_temp.try($q$select 1/count(*) from public.shop_orders where id = 'SH-TEST0230C'$q$);
reset role;
insert into probe select '41. the order''s OWN buyer reads it despite the past sentinel year — ownership, not year, gates it', 'ok',
  (select v from r where k = 'allow_mine');

select pg_temp.as_admin();
set local role authenticated;
insert into r select 'staff_sees_past', pg_temp.try($q$select 1/count(*) from public.shop_orders where id = 'SH-TEST0230C'$q$);
reset role;
insert into probe select '42. shop admin reads the past-year order too — admin sees every year', 'ok', (select v from r where k = 'staff_sees_past');

-- ── §E shop_order_totals() — current-year scoping, snapshot deltas only ────
select pg_temp.as_admin();
set local role authenticated;
insert into r select 'ins_current',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total)
               values ('SH-TEST0230E', (select uid from subj_buyer), 'paid', 777, 0, 777)$q$);
insert into r select 'ins_null_year',
  pg_temp.try($q$insert into public.shop_orders (id, buyer_id, status, subtotal, fee, total)
               values ('SH-TEST0230F', (select uid from subj_buyer), 'paid', 333, 0, 333)$q$);
-- The trigger is BEFORE INSERT only, so the ONLY way a row ends up with a
-- genuinely null samo_year_be (what every one of the 50 real rows looked
-- like before 0230's own backfill ran) is an UPDATE after the fact — same
-- "never backfilled" simulation §C already uses on SH-TEST0230C.
insert into r select 'null_f', pg_temp.try($q$update public.shop_orders set samo_year_be = null where id = 'SH-TEST0230F'$q$);
reset role;
insert into probe select '50. a fresh order is stamped the CURRENT year (2696)', '2696',
  (select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230E');
insert into probe select '51. a legacy null-year row (simulated) stays null — nothing re-stamps on UPDATE', '',
  coalesce((select samo_year_be::text from public.shop_orders where id = 'SH-TEST0230F'), '');
select pg_temp.take_snap('t6_after_ef');
insert into probe select '52. orders_total rose by exactly 777+333 — the 2696 order AND the unresolvable null-year order both count, nothing else does', '1110',
  pg_temp.delta('t5_after_2696_opens', 't6_after_ef', 'orders_total')::text;
insert into probe select '53. revenue rose by exactly the same 1110 — both are "paid"', '1110',
  pg_temp.delta('t5_after_2696_opens', 't6_after_ef', 'revenue')::text;

-- ── §F current_samo_year() is NULL → fall back to counting EVERYTHING ──────
-- Should not happen once a team exists (start_team_term always swaps
-- is_current atomically) — but if it ever does, this function must not go
-- near-silent (only null-year rows); it must behave like the ORIGINAL 0206
-- (unconditional over every row), not drop every properly-stamped order.
update public.team_terms set is_current = false where year = 2696;
insert into probe select '60. current_samo_year() is now NULL (no current term)', '',
  coalesce(public.current_samo_year()::text, '');
select pg_temp.take_snap('t7_no_current_year');
-- Recomputed independently from the LIVE table, never a hardcoded literal —
-- this samo-dev database already carries real rows outside 2696/null (year
-- 2569 and earlier), and the fallback must pick up EVERY one of them, not
-- just this proof's own A/B/C/C2. "Outside the 2696/null scope" is exactly
-- what t6's scoped total excluded; the jump must equal exactly that.
insert into probe select '61. orders_total jumps by exactly the sum of every non-cancel row OUTSIDE the 2696/null scope — the fallback adds exactly what was excluded, nothing more',
  (select coalesce(sum(total), 0)::text from public.shop_orders
    where status <> 'cancel' and not (samo_year_be is null or samo_year_be = 2696)),
  pg_temp.delta('t6_after_ef', 't7_no_current_year', 'orders_total')::text;
insert into probe select '62. revenue jumps by exactly the sum of every revenue-eligible row OUTSIDE the 2696/null scope',
  (select coalesce(sum(total), 0)::text from public.shop_orders
    where status not in ('pending', 'review', 'slip_mismatch', 'cancel')
      and not (samo_year_be is null or samo_year_be = 2696)),
  pg_temp.delta('t6_after_ef', 't7_no_current_year', 'revenue')::text;
update public.team_terms set is_current = true where year = 2696;

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
