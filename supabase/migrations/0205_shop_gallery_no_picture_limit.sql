-- ============================================================
-- 0205 — a product can have any number of pictures
--
-- ASKED (owner, 2026-09-22): "i want unlimited". 0203 capped a product at 8
-- pictures (a default chosen in docs/SHOP-GALLERY.md §10, never the owner's).
-- THIS SHAPE: the LIVE shop_images_ok body with ONLY the count check removed.
-- Every other rule stays — the shape, the Google-hosted URL, positive sizes, a
-- string colour — because those are about what a VISITOR's browser is handed,
-- not about how many. The admin editor asks once before adding more than 20
-- files at a time (an accidental whole-folder drag), and paces the uploads;
-- neither is a limit.
-- Proof: tools/shop0203-gallery.mjs ("40 pictures are allowed").
-- ============================================================

create or replace function public.shop_images_ok(p jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(p) = 'array'
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
