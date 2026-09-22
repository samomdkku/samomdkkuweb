-- ============================================================
-- 0204 — a tab opened before the gallery shipped cannot drop or duplicate a
--        picture (docs/SHOP-GALLERY.md §2, the stale branch)
--
-- FOUND (2026-09-22, review of 0203): an admin tab from before 0203 still sends
-- `image_url` on EVERY product save — the cover it LOADED, not a change. 0203's
-- stale branch read any such value as "set the cover", so:
--   · a product with no picture when that tab loaded sends image_url = null,
--     and 0203 removed images[0] — deleting a picture another admin had added;
--   · a tab holding the OLD cover, after someone reordered, overwrote images[0]
--     with it — the old cover twice, the new one gone (its Drive file kept).
-- THIS SHAPE: the stale branch acts only on a URL that is genuinely NEW to the
-- gallery (not already one of its pictures) — the one thing an old client's
-- "เปลี่ยนรูป" can mean. A null, or a picture already present, is a no-op;
-- the cover is re-derived either way. The new client never sends image_url.
-- Rebuilt from the LIVE 0203 body; only the stale branch changed.
-- Proof: tools/shop0203-gallery.mjs (the two new "stale:" rows).
-- ============================================================

create or replace function public.shop_products_cover()
returns trigger
language plpgsql
as $$
declare
  v_entry jsonb;
  v_base  text;
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
    -- STALE TAB (0204): only a picture NEW to the gallery replaces the cover.
    v_base := public.shop_image_base(new.image_url);
    if v_base is not null and not exists (
         select 1 from jsonb_array_elements(new.images) e where e ->> 'url' = v_base) then
      v_entry := jsonb_build_object('url', v_base, 'w', null, 'h', null, 'color', null);
      new.images := case when jsonb_array_length(new.images) = 0 then jsonb_build_array(v_entry)
                         else jsonb_set(new.images, '{0}', v_entry) end;
    end if;
    new.image_url := public.shop_image_cover(new.images);
  end if;
  return new;
end;
$$;
