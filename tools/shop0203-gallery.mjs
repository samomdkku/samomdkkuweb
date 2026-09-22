#!/usr/bin/env node
// ============================================================
// shop0203-gallery.mjs — a product's pictures, and the cover that follows them.
//
// One transaction that ROLLS BACK. What it asks of the LIVE database:
//
//  1. COVER. image_url is derived from images[0] (+ =w1200 for lh3) on insert,
//     reorder and clear — the trigger is image_url's one writer.
//  2. STALE TAB. A client from before 0203 writes image_url ONLY: that replaces
//     the cover and KEEPS the other pictures; an old-client insert becomes a
//     gallery of one. The branch nobody clicks on purpose — so it is asserted.
//  3. SHAPE. The constraint refuses a 9th picture, a non-Google URL, an unknown
//     key and a non-positive size — each DENY beside an ALLOW.
//  4. RLS unchanged: anon cannot write a product's pictures; the admin path can.
//
//   node tools/shop0203-gallery.mjs                    # production
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL SUPABASE_ACCESS_TOKEN=$SUPABASE_DEV_ACCESS_TOKEN node tools/shop0203-gallery.mjs
// RUN BEFORE 0203 AND IT ERRORS AT THE FIRST INSERT (no `images` column).
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';

const target = announceTarget();
const L = (id) => `https://lh3.googleusercontent.com/d/${id}`;
const img = (id, color = null) => ({ url: L(id), w: 2400, h: 3000, color });
const J = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;

-- 1. COVER
insert into public.shop_products (id, name, type, source, price, is_active, images)
values ('probe0203', 'probe0203', 'apparel-shirt', 'md', 100, true, ${J([img('A'), img('B', 'black'), img('C', 'red')])});
insert into probe values ('cover: insert sets the cover from picture 1', '${L('A')}=w1200',
  (select image_url from public.shop_products where id = 'probe0203'));
update public.shop_products set images = ${J([img('C', 'red'), img('A'), img('B', 'black')])} where id = 'probe0203';
insert into probe values ('cover: reordering moves the cover', '${L('C')}=w1200',
  (select image_url from public.shop_products where id = 'probe0203'));

-- 2. STALE TAB — writes image_url only
update public.shop_products set image_url = '${L('Z')}=w1200' where id = 'probe0203';
insert into probe values ('stale: an image_url-only write replaces the cover', '${L('Z')}',
  (select images -> 0 ->> 'url' from public.shop_products where id = 'probe0203'));
insert into probe values ('stale: …and keeps the other pictures', '3',
  (select jsonb_array_length(images)::text from public.shop_products where id = 'probe0203'));
insert into probe values ('stale: …and the colour tags on them', 'black',
  (select images -> 2 ->> 'color' from public.shop_products where id = 'probe0203'));
insert into public.shop_products (id, name, type, source, price, is_active, image_url)
values ('probe0203old', 'probe0203old', 'apparel-shirt', 'md', 100, true, '${L('OLD')}=w1200');
insert into probe values ('stale: an old-client insert becomes a gallery of one', '${L('OLD')}',
  (select (images -> 0 ->> 'url') || '/' || jsonb_array_length(images) from public.shop_products where id = 'probe0203old')
  );
update probe set expected = '${L('OLD')}/1' where k = 'stale: an old-client insert becomes a gallery of one';
update public.shop_products set images = '[]' where id = 'probe0203';
insert into probe values ('cover: no pictures, no cover', 'null',
  coalesce((select image_url from public.shop_products where id = 'probe0203'), 'null'));

-- 3. SHAPE — ALLOW 8, then each DENY
do $$ begin
  update public.shop_products set images = ${J(Array.from({ length: 8 }, (_, i) => img(`P${i}`)))} where id = 'probe0203';
  insert into probe values ('shape: 8 pictures are allowed', 'allowed', 'allowed');
exception when others then insert into probe values ('shape: 8 pictures are allowed', 'allowed', sqlerrm); end $$;
${[
    ['a 9th picture', Array.from({ length: 9 }, (_, i) => img(`P${i}`))],
    ['a non-Google URL', [{ url: 'https://evil.example/x.png', w: 1, h: 1, color: null }]],
    ['a URL with a quote', [{ url: `${L('Q')}"onerror="1`, w: 1, h: 1, color: null }]],
    ['an unknown key', [{ ...img('K'), onclick: 'x' }]],
    ['a zero width', [{ ...img('W'), w: 0 }]],
    ['a text width', [{ ...img('W'), w: 'abc' }]],
    ['a numeric colour', [{ ...img('N'), color: 5 }]],
  ].map(([name, v]) => `do $$ begin
  update public.shop_products set images = ${J(v)} where id = 'probe0203';
  insert into probe values ('shape: ${name} is refused', 'refused', 'ACCEPTED');
exception when others then insert into probe values ('shape: ${name} is refused', 'refused',
  case when sqlerrm like '%shop_products_images_ok%' then 'refused' else sqlerrm end); end $$;`).join('\n')}

-- 4. RLS — anon is refused, over the same row the admin path writes
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
update public.shop_products set images = ${J([img('ANON')])} where id = 'probe0203';
reset role;
insert into probe values ('rls: anon cannot change a product''s pictures', 'unchanged',
  case when (select images -> 0 ->> 'url' from public.shop_products where id = 'probe0203') = '${L('ANON')}'
       then 'CHANGED' else 'unchanged' end);

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
