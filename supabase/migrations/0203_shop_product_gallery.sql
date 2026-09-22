-- ============================================================
-- 0203 — a product can have several pictures (docs/SHOP-GALLERY.md)
--
-- ASKED (owner, 2026-09-22): upload more than one picture per product, tap to
-- zoom, and a picture per colour.
--
-- THE SHAPE (SHOP-GALLERY §2):
--   shop_products.images jsonb — an ordered array, [0] is the cover:
--     [{ "url": "https://lh3.googleusercontent.com/d/<id>", "w": 2400, "h": 3000,
--        "color": null | "<colors[].id>" }]
--   `url` is stored WITHOUT an lh3 size suffix; readers ask for a width.
--
-- image_url STAYS — as the COVER, derived by a trigger. About twelve readers
-- (cards, cart, checkout, orders, announcement fallbacks, admin tables) use it,
-- and a second WRITABLE copy of one fact is how this repo's worst drift
-- happened (mistakes class 6). From now on the trigger is its one writer —
-- except a tab opened before this deploy, which still writes image_url alone:
-- that replaces the COVER and never shrinks the gallery (the stale branch).
--
-- ADD-only, so it is safe before the client ships (skills/ship-a-migration.md).
-- Proof: tools/shop0203-gallery.mjs.
-- ============================================================

-- (1) One URL rule for every Google-hosted shop file. 0202's slip rule becomes
--     a wrapper, so there is ONE regex, not two that can drift.
create or replace function public.shop_drive_url_ok(p_url text)
returns boolean
language sql immutable
as $$
  select p_url ~ '^https://(lh3\.googleusercontent\.com|drive\.google\.com)/[A-Za-z0-9/_=?&.%-]+$'
$$;

create or replace function public.shop_slip_url_ok(p_url text)
returns boolean
language sql immutable
as $$ select public.shop_drive_url_ok(p_url) $$;

-- (2) The column, and the shape it may hold. Refused by the DATABASE, not just
--     the editor: these URLs are rendered to every visitor.
alter table public.shop_products add column if not exists images jsonb not null default '[]';

create or replace function public.shop_images_ok(p jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 8
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('url', 'w', 'h', 'color'))
           or not coalesce(public.shop_drive_url_ok(e ->> 'url'), false)
           -- CASE, not AND: SQL does not promise short-circuit, and a cast of
           -- "abc" would raise instead of refusing.
           or case jsonb_typeof(e -> 'w') when 'null' then false when 'number' then (e ->> 'w')::numeric <= 0
                                          else e ? 'w' end
           or case jsonb_typeof(e -> 'h') when 'null' then false when 'number' then (e ->> 'h')::numeric <= 0
                                          else e ? 'h' end
           or (e ? 'color' and e -> 'color' <> 'null'::jsonb and jsonb_typeof(e -> 'color') <> 'string')
     )
$$;

-- (3) lh3 URLs lose their size suffix in `images`; the cover gets =w1200 back,
--     which is what every existing image_url reader was written against.
create or replace function public.shop_image_base(p_url text)
returns text
language sql immutable
as $$
  select case when p_url ~ '^https://lh3\.googleusercontent\.com/d/'
              then regexp_replace(p_url, '=[A-Za-z0-9-]+$', '')
              else p_url end
$$;

create or replace function public.shop_image_cover(p_images jsonb)
returns text
language sql immutable
as $$
  select case
    when jsonb_array_length(coalesce(p_images, '[]')) = 0 then null
    when (p_images -> 0 ->> 'url') ~ '^https://lh3\.googleusercontent\.com/d/'
      then (p_images -> 0 ->> 'url') || '=w1200'
    else p_images -> 0 ->> 'url'
  end
$$;

-- (4) Backfill BEFORE the constraint: the one live picture becomes a gallery of one.
update public.shop_products
   set images = jsonb_build_array(jsonb_build_object(
         'url', public.shop_image_base(image_url), 'w', null, 'h', null, 'color', null))
 where image_url is not null and images = '[]';

alter table public.shop_products drop constraint if exists shop_products_images_ok;
alter table public.shop_products add constraint shop_products_images_ok check (public.shop_images_ok(images));

-- (5) The cover follows the gallery. Two exclusive branches, so it cannot loop.
create or replace function public.shop_products_cover()
returns trigger
language plpgsql
as $$
declare
  v_entry jsonb;
begin
  if tg_op = 'INSERT' then
    if jsonb_array_length(new.images) = 0 and new.image_url is not null then
      -- An old client creating a product: it only knows image_url.
      new.images := jsonb_build_array(jsonb_build_object(
        'url', public.shop_image_base(new.image_url), 'w', null, 'h', null, 'color', null));
    end if;
    new.image_url := public.shop_image_cover(new.images);
    return new;
  end if;

  if new.images is distinct from old.images then
    new.image_url := public.shop_image_cover(new.images);
  elsif new.image_url is distinct from old.image_url then
    -- STALE TAB: wrote image_url only. Replace the cover; keep the rest.
    if new.image_url is null then
      new.images := case when jsonb_array_length(new.images) > 0 then new.images - 0 else new.images end;
    else
      v_entry := jsonb_build_object('url', public.shop_image_base(new.image_url), 'w', null, 'h', null, 'color', null);
      new.images := case when jsonb_array_length(new.images) = 0 then jsonb_build_array(v_entry)
                         else jsonb_set(new.images, '{0}', v_entry) end;
    end if;
    new.image_url := public.shop_image_cover(new.images);
  end if;
  return new;
end;
$$;

drop trigger if exists shop_products_cover on public.shop_products;
create trigger shop_products_cover
  before insert or update on public.shop_products
  for each row execute function public.shop_products_cover();
