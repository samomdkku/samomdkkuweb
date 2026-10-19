-- ============================================================
-- 0230 — SAMO Shop orders get a SAMO year (night agent, task 9 of the
-- 2026-10-18 queue). Design: docs/YEAR-ROLLOVER.md § SAMO Shop. Core infra:
-- 0219. Pattern copied from 0220 (pr_tickets) — same column, same trigger,
-- same one-time backfill shape; this header only explains what differs.
--
-- WHY A STORED COLUMN, STAMPED AT INSERT, NEVER RECOMPUTED. Same reason as
-- 0220: `place_shop_order` is SECURITY DEFINER and inserts as the BUYER
-- (shop_orders_insert_buyer, 0199) — an invoker-rights read of team_terms at
-- INSERT time would see zero rows under RLS and silently stamp NULL on
-- every order a real buyer places. `samo_year_be_default()` (0219) already
-- carries the SECURITY DEFINER `current_samo_year()` call, so attaching it
-- here costs nothing new.
--
-- WHY THE BACKFILL READS `placed_at`. docs/YEAR-ROLLOVER.md's own § SAMO
-- Shop decision (and STATE.md, measured 2026-10-13): shop_orders has NO
-- `created_at` — only `placed_at`/`updated_at` — and `place_shop_order` sets
-- `placed_at` in the SAME insert that creates the row, so "now" and
-- "placed_at" are the same instant for every order made through the normal
-- checkout RPC. There is no second, earlier timestamp to prefer over it the
-- way 0220 prefers PR's `timestamp` over `created_at`.
--
-- WHY UNPAID/IN-REVIEW ORDERS KEEP THEIR ORIGINAL YEAR, NOT JUST BY NOT
-- BEING TOUCHED BY A ROLLOVER — THEY NEVER GET ONE IN THE FIRST PLACE. The
-- design doc's explicit decision: an order opened under last year's team and
-- still `pending`/`review` keeps the year it was STAMPED AT INSERT, same as
-- a `paid` one — this migration does not special-case status at all, because
-- the stamped-once-at-insert rule already gives every order exactly that
-- behaviour for free. A later team sees it in a "ค้างจากปีก่อน" admin filter
-- (the UI half of this task), never silently folded into "this year".
-- Rejected alternative (design doc, restated here because this is the
-- migration that would have had to implement it): reassigning an in-flight
-- order's year at rollover — rejected because it would make a graduating
-- team's PENDING revenue invisible on its own books.
--
-- WHY NO RLS CHANGE. Buyers already read only their own rows
-- (shop_orders_select_buyer) and shop admins already read every row
-- (current_user_is_shop_admin()) — both year-independent, same "a FILTER,
-- never an access boundary" rule 0220 follows. Only the admin UI defaults to
-- the current year; nothing in the database hides a past order from an
-- admin who asks for it.
--
-- WHY shop_order_totals() (0206) IS RECREATED TO SCOPE TO THE CURRENT YEAR.
-- It backs the per-order Discord ping's "how is the shop doing" line
-- (awaiting_review / orders / orders_total / revenue) — an operational
-- snapshot of THIS team's shop, not an all-time counter that only grows.
-- Left unscoped, the day after a handover the incoming team's first sale
-- would ping Discord with a number that includes every order the outgoing
-- team ever took — exactly the "the next samoyear ... it'll be a mess"
-- complaint 0220's header already quotes the owner making about PR. Scoped
-- to `current_samo_year()` OR NULL (an unresolvable legacy row, same
-- fail-open-to-visible rule as everywhere else in this design) — not to
-- whatever year the admin's BROWSER happens to be filtered to, because the
-- caller is the notify service, not a signed-in admin with a filter.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. shop_orders.samo_year_be — ADD only, nullable, admin-overridable (same
--    shape as pr_tickets.samo_year_be / projects.fiscal_year_be).
-- ---------------------------------------------------------------------------
alter table public.shop_orders
  add column if not exists samo_year_be smallint;

comment on column public.shop_orders.samo_year_be is
  'Which SAMO year (team_terms.year, พ.ศ.) this order was placed under. '
  'Stamped ONCE at INSERT by shop_orders_samo_year_default — never '
  'recomputed on an update, so an unpaid order that sits open across a '
  'rollover keeps the year it was actually placed in (docs/YEAR-ROLLOVER.md '
  '§ SAMO Shop: "unpaid/in-review orders do NOT inherit a new year"). An '
  'admin walk-in order (adminCreateOrder) can backdate placed_at; this '
  'column still reflects the team in office WHEN THE ROW WAS CREATED, which '
  'can then legitimately disagree with placed_at — same divergence '
  'fiscal_year_be already tolerates. NULL only for a row the one-time '
  'backfill below could not resolve.';

create index if not exists shop_orders_samo_year_idx
  on public.shop_orders (samo_year_be);

-- ---------------------------------------------------------------------------
-- 2. The trigger — INSERT only. Reuses 0219's one shared trigger body.
-- ---------------------------------------------------------------------------
drop trigger if exists shop_orders_samo_year_default on public.shop_orders;
create trigger shop_orders_samo_year_default
  before insert on public.shop_orders
  for each row execute function public.samo_year_be_default();

-- ---------------------------------------------------------------------------
-- 3. ONE-TIME backfill from placed_at — every existing row has
--    samo_year_be = NULL because the column did not exist until this
--    migration, so deriving one overwrites no human decision (same
--    exception 0220/0223 already applied to their own pre-existing rows).
-- ---------------------------------------------------------------------------
update public.shop_orders
   set samo_year_be = public.samo_year_for_timestamp(placed_at)
 where samo_year_be is null;

-- ---------------------------------------------------------------------------
-- 4. shop_order_totals() (0206) — scope to the current SAMO year. Same
--    function signature (no caller change needed — the notify service
--    calls it with zero arguments), same grant (service_role only), only
--    the WHERE clause changes.
-- ---------------------------------------------------------------------------
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
  from public.shop_orders
  where samo_year_be is null or samo_year_be = public.current_samo_year();
$$;

comment on function public.shop_order_totals() is
  'Shop-wide totals for the per-order Discord ping (functions/_discord.js), '
  'service_role only — see 0206''s original header for why. Scoped to the '
  'CURRENT SAMO year (0230): this is an operational snapshot of the team '
  'presently in office, not an all-time counter. A row the backfill could '
  'not resolve (samo_year_be is null) is counted rather than silently '
  'dropped, same fail-open-to-visible rule the rest of this design uses.';

-- pg_default_acl re-grants EXECUTE to anon/authenticated on every
-- `create or replace function` (mistakes class 6, "a create INHERITS too")
-- — the original grants must be restated, not just assumed to survive.
revoke all on function public.shop_order_totals() from public, anon, authenticated;
grant execute on function public.shop_order_totals() to service_role;
