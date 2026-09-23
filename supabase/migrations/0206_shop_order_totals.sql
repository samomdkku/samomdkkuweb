-- ============================================================
-- 0206 — shop totals for the new-order Discord message
--
-- ASKED (owner, 2026-09-23): the shop's Discord message should also say how
-- many slips are still waiting to be checked, how many orders there are in
-- all and for how much, and how much revenue has come in.
--
-- WHY A FUNCTION, AND WHY ONLY service_role. The message is built by the notify
-- service with the BUYER's session (functions/_discord.js), and RLS lets a
-- buyer read their own orders only — correctly. Shop-wide totals must not be
-- opened to every signed-in student to make a Discord message possible, so the
-- service reads them with the key it already holds, and this function is the
-- ONLY thing that key may call for it: three numbers, no row, no person.
--
-- SECURITY INVOKER on purpose: service_role bypasses RLS, so it needs no
-- elevation. If the grant below were ever wrong, a student calling this would
-- get totals over the rows RLS already shows them — their own orders — not the
-- shop's.
--
-- THE RULES ARE THE ADMIN DASHBOARD'S (src/js/shop/data.js
-- NOT_YET_REVENUE_STATUSES; a test holds this file to that list):
--   awaiting_review = status 'review' (a slip was sent, nobody has checked it)
--   orders / orders_total = everything except 'cancel'
--   revenue = everything except pending, review, slip_mismatch, cancel
-- ============================================================

create or replace function public.shop_order_totals()
returns jsonb
language sql stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'awaiting_review', count(*) filter (where status = 'review'),
    'orders',          count(*) filter (where status <> 'cancel'),
    'orders_total',    coalesce(sum(total) filter (where status <> 'cancel'), 0),
    'revenue',         coalesce(sum(total) filter (where status not in ('pending', 'review', 'slip_mismatch', 'cancel')), 0)
  )
  from public.shop_orders;
$$;

-- pg_default_acl grants EXECUTE on a new public function to anon and
-- authenticated (mistakes class 6, "a create INHERITS too").
revoke all on function public.shop_order_totals() from public, anon, authenticated;
grant execute on function public.shop_order_totals() to service_role;
