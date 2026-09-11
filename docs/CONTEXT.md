# Architecture

> The system map, database schema, access rules and how deploys work

Read this when editing:
- Anything in `supabase/migrations/`
- Anything that crosses the frontend ↔ backend boundary
- The auth model or RLS policies
- The deploy / env-var story (the KKU VM — see "One host" below)

For day-to-day feature work, `CLAUDE.md` is enough.

---

## Overall request flow

```
Browser (SPA served by nginx on the KKU VM)
  │
  ├─→ Supabase PostgREST (data CRUD)         ── primary read/write path
  │     ↳ public.users / pr_tickets / vs_tickets / announcements / pr_agents
  │     ↳ projects / project_documents / project_files / project_notifications
  │     ↳ gated by RLS policies (see schema below)
  │
  ├─→ Supabase Auth /auth/v1/*               ── sign in / out / refresh
  │     ↳ Google OAuth + email/password (synthetic emails)
  │
  ├─→ GAS /exec (prform — Drive + email only)  ── narrow & specific
  │     ↳ uploadPRFile        → writes to Google Drive (PR/)
  │     ↳ uploadShopFile      → writes to Drive at Shop/<nested path>
  │     ↳ uploadProjectFile   → writes to Drive at Projects/<nested path>
  │     ↳ notifyProjectEmail  → MailApp.sendEmail to uni_staff
  │     ↳ getProjectFileData   → READS a Projects/ file's BYTES (e-sign)
  │     ↳ statProjectFiles     → reads metadata + `trashed` for ids you hold
  │     ↳ listProjectFolderFiles → lists a Projects/ folder — GATED on a
  │                               `knownFileId` that is really in it, because
  │                               this /exec URL is public and unauthenticated
  │
  └─→ /notify (all Discord) — nginx proxies it to the samo-notify Node
        service on 127.0.0.1:8787 (server/notify-server.mjs)
        ↳ notifyPROnly                    → PR-team webhook
        ↳ notifyVSOnly / notifyVSConsult  → per-dept VS webhooks
        ↳ notifyProjectDiscord            → SAMO admin webhook
           (webhooks in /etc/samo-notify.env on the VM. functions/notify.js is
            the Cloudflare-Pages twin of the same handler, kept in the repo and
            behaviourally identical — it is NOT what serves production.)
```

GAS is intentionally minimal post-migration. Drops to 104 + 154 lines.
Everything that USED to be in GAS (submit, track, staff dashboards,
announcements) now talks to Supabase directly.

---

## Frontend module map

```
src/js/
├── main.js              ─ entry point; wires window.* handlers; auth subscriber
├── db.js                ─ Supabase client + dbRest() raw-fetch helper
├── auth.js              ─ sign in / out, currentUser, onAuthChange subscribers
├── signin-modal.js      ─ the ONE implementation of the sign-in modal: screen
│                          switch, password submit/register, reveal toggle, and
│                          the reset-on-close. Both entries call
│                          mountSigninModal(); nothing about that screen is
│                          defined anywhere else (it used to be duplicated
│                          verbatim in main.js + admin-main.js with the reset in
│                          account-switch.js)
├── strip-comments.js    ─ comment/string-aware scanner used by the guard TESTS.
│                          Not shipped logic — but load-bearing: four ratchets
│                          read source through it, and the regex it replaced was
│                          blanking 24k characters (see mistakes/tooling-proofs)
├── pr-auth.js           ─ reflects auth state into PR form's hidden inputs
├── pr-depts.js          ─ PR ฝ่าย list (single source of truth) + read-side aliases
├── pr-form.js           ─ PR ticket submit (raw fetch, idempotent retry)
├── pr-tracking.js       ─ user-facing PR history + ticket lookup
├── pr-staff.js          ─ kanban dashboard, modal, agents management
├── vs-form.js           ─ VS ticket submit
├── vs-tracking.js       ─ VS user history + ticket lookup + reply
├── vs-board.js          ─ VS public "Problem" board (browse/me-too/comments)
├── vs-staff.js          ─ VS staff dashboard + SE publish-to-board panel
├── announcements.js     ─ announcement CRUD via dbRest
├── discord-queue.js     ─ shared Discord core: ONE global rate-limit-aware
│                          queue + logged GAS caller for PR/VS/projects
├── notify.js            ─ PR + VS Discord fire-and-forget (rides discord-queue)
├── gas-post.js          ─ THE GAS caller for paths where a person is waiting:
│                         retries Google's HTML error page, never a timeout
│                         (a retried upload would double-write to Drive)
├── uploads.js           ─ Drive upload via GAS uploadPRFile (through gas-post)
├── config.js            ─ GAS_API_URL (uploads+email) + NOTIFY_FN_URL (Discord)
├── utils.js             ─ formatThaiDate, renderTimeline, decodeJwtResponse,
│                          escHtml, safeUrl
└── shop/                ─ SAMO Shop feature (browse, cart, checkout, orders,
    │                       admin). Lazy-loads its data on first tab-show.
    ├── index.js          ─ initShop() entry; sub-nav, FAB, auth subscriber
    ├── data.js           ─ SHOP_SOURCES / SHOP_TYPES / STAGES_*; thb, fmtDate
    ├── api.js            ─ dbRest CRUD: products, orders+items, batches, settings
    ├── state.js          ─ cart store (localStorage), subscribers
    ├── uploads.js        ─ uploadShopFile(file, folderPath) — Drive via GAS
    ├── products.js       ─ browse grid, filter bar, launch strip, detail modal
    ├── cart.js           ─ offcanvas cart drawer + floating FAB
    ├── checkout.js       ─ checkout panel, slip upload, place-order
    ├── orders.js         ─ "My Orders" timeline, status filter, pickup callout
    └── admin.js          ─ orders table, slip-verify queue, batches CRUD,
                            product CRUD, QR settings (mounts into tab-admin)

└── projects/            ─ Project / document tracking workflow (vp_admin →
    │                       uni_staff). Lazy-loaded on first tab-show.
    ├── index.js          ─ initProjects(); role gating; sub-nav; hash routing
    ├── data.js           ─ statuses, formatters, id generators, Drive paths
    ├── api.js            ─ dbRest CRUD: projects, documents, files,
    │                       notifications, settings, doc types
    ├── uploads.js        ─ uploadProjectFile(file, folderPath) via GAS
    ├── notify.js         ─ fan-out: in-app row + email (uni) + Discord (vp)
    ├── send.js           ─ VP-Admin create-project / send-document modal
    ├── inbox.js          ─ 2-pane list + detail panel; per-doc actions,
    │                       file replace (non-destructive supersede chain)
    ├── manage.js         ─ doc type lookup CRUD + settings (recipient
    │                       email, notification preferences)
    └── notifications.js  ─ navbar bell + offcanvas drawer, polling

src/html/                ─ Vite HTML partials. index.html includes them.
src/css/                 ─ Bootstrap + brand vars in base.css + topic CSS files.
```

---

## Supabase schema (canonical: `supabase/migrations/0001_initial_schema.sql`)

Tables, condensed:

```
users (uuid id PK, email, username, display_name, method, role, department,
       permissions, has_password, phone, created_at, last_seen_at)
  ↳ FK to auth.users (cascade delete)
  ↳ phone (mig 0036): self-set contact phone; autofills samoshop checkout.
    Self-writable (NOT a privileged column per the 0028 self-update guard).
  ↳ role IN ('user', 'pr_staff', 'vs_staff', 'dev')
  ↳ Trigger handle_new_auth_user populates from raw_user_meta_data on signup

announcements (bigserial id PK, title, content, department, thumbnail_url,
               status, created_by FK users(id), created_at, updated_at)
  ↳ Trigger touch_updated_at on update

pr_tickets (text id PK ["PR-XXXXXX"], timestamp, department, contact,
            content_name, job_type, platforms text[], posting_channel,
            publish_date, deadline_status, rush_reason, brief, caption,
            file_url, silent_notify boolean, project_account, copost_with,
            submitter_id FK users(id), submitter_label, status,
            remarks jsonb, assignees text[], other_platforms text[],
            other_platform_reason, created_at)

vs_tickets (text id PK ["VS-YYMMDD-HHMM"], timestamp, display_name, year,
            submitter_id FK users(id), submitter_label, problem text,
            target_dept, requested_dept, status, is_emergency boolean,
            remarks jsonb, created_at)

pr_agents (id integer PK = 1 [single-row config table], agents text[],
           updated_at)

reserved_staff_usernames (username PK, role, email, created_at)
  ↳ Lists samomdkkupr / samomdkkuvssound / samomdkkushop / samomdkkudev
    for the migrator. Role check allows pr_staff, vs_staff, shop_admin, dev.
```

### SAMO Shop (canonical: `0003_samoshop_schema.sql`, `0004_seed_shop_admin.sql`)

```
shop_products (text id PK, name, sub, description, type, source,
               price, sizes text[], colors jsonb, fits text[],
               hue, image_url, is_new, is_presale, presale_note,
               popularity, is_active, stock_matrix jsonb,
               promptpay_qr_id FK shop_promptpay_qrs(id) [null=default], -- mig 0057
               pickup_location_id FK shop_pickup_locations(id) [null], -- mig 0057
               added_at, created_by FK users(id), updated_at)
  ↳ source IN ('md','rt','mdi','sittikao')  -- mig 0007; = OWNERSHIP KEY:
    the department that owns/fulfils the product (MD, MDI, …). Multi-department
    shop is Model A (shared, trust-based): access control is GLOBAL today (any
    shop_admin sees all). Future Model B scopes writes/reads per source — see STATE.md.
  ↳ type = loose text; picker source is shop_product_types (NOT an FK, so
    deleting a type never breaks a product)

shop_orders (text id PK ["<CODE>NNNN"], buyer_id FK users(id) [null=admin-created],
             buyer_label, buyer_name, buyer_email, buyer_phone, status,
             subtotal, fee, total, is_preorder [any item preorder@buy-time],
             slip_url [=latest], slips jsonb [{url,at}…], slip_uploaded_at,
             pickup_location, pickup_batch_id FK shop_pickup_batches(id),
             buyer_note, admin_note, cancel_reason,
             timeline jsonb, placed_at, updated_at)
  ↳ status (PAYMENT phase) IN ('pending','review','paid', +cancel/refund_pending/
    refunded/slip_mismatch/no_show + legacy produce/ready/done/exchange)

shop_order_items (bigserial id PK, order_id FK shop_orders(id) CASCADE,
                  product_id FK shop_products(id) RESTRICT,
                  size, color, fit, qty, unit_price,
                  product_source [frozen owner-dept snapshot @ buy-time, mig 0058],
                  item_status, item_timeline jsonb, is_preorder)
  ↳ product_source: SECURITY DEFINER before-insert trigger stamps it from
    shop_products.source and ALWAYS overrides the client value (unspoofable);
    frozen like unit_price. Enables future per-department order-item filtering.
  ↳ item_status (FULFILMENT phase) IN ('paid','produce','ready','done',
    'exchange','no_show'); is_preorder = frozen is_presale snapshot @ buy-time

shop_banners (uuid id PK, image_url, caption, link_url, display_order,
              is_active, placement, created_at)   [mig 0019, 0037]
  ↳ placement IN ('launch','announcement'), default 'launch'. Drives two
    customer swipe carousels (เปิดตัวล่าสุด / ประกาศ) off one admin UI;
    display_order is scoped per-placement. RLS: public read, shop-admin write.
```

**Hybrid order model (migrations 0033–0035).** The order's `status` carries
only the PAYMENT phase; once paid, each line item carries its own
fulfilment `item_status` so products in one order progress independently.
The overall display stage is a JS rollup (`rollupOrderStage` in
`src/js/shop/data.js` — least-progressed item). `place_shop_order(...)`
(0034, SECURITY DEFINER) stamps per-item `is_preorder` + seeds
`item_status`, validates stock atomically under a row lock, and persists
`buyer_phone` + `slips`. `apply_product_production_status` (stock tab) and
the order→paid trigger cascade to `item_status`, not the whole order.
Reserved-stock aggregates (`shop_reserved_matrix_all`) count at the item
level (an item stops reserving once `item_status='done'`). Migration 0038:
they also count ONLY `is_preorder=false` items — preorder is made-to-order
and must not deplete finite stock (or over-count the oversell guard).
```

shop_pickup_batches (bigserial id PK, title, product_ids text[],
                     location, dates text[], hours, note,
                     contact_gmail, contact_instagram, is_active,
                     created_by FK users(id), created_at, updated_at)

shop_settings (id integer PK = 1 [single-row config], promptpay_name,
               promptpay_id, promptpay_qr_url, instructions,
               contact_gmail, contact_instagram, updated_at)
  ↳ still the GLOBAL fallback for instructions/contacts; the single QR is
    now the seeded is_default row of shop_promptpay_qrs (see below)

-- Catalog config (migration 0057) — admin-managed lists --------------
shop_product_types (text id PK, label, icon, sort_order, is_active,
                    created_at, updated_at)   [seeded from the old SHOP_TYPES]

shop_promptpay_qrs (bigserial id PK, label, promptpay_name, promptpay_id,
                    qr_url, instructions [''=use shop_settings], is_default,
                    is_active, sort_order, created_by FK users(id), ts)
  ↳ unique(is_default) where is_default — exactly one default. A product
    with null promptpay_qr_id routes to the default row. CHECKOUT SPLITS
    THE CART BY ACCOUNT: one shop_orders row per distinct QR (each with its
    own slip). Public SELECT using(true) (like shop_settings); admin write.

shop_pickup_locations (bigserial id PK, label, detail, is_active,
                       sort_order, created_at, updated_at)
  ↳ per-product pickup shown to the buyer at checkout / product modal.
    SELECT using(is_active OR shop-admin); admin write.
```

Also: `users.role` check constraint expanded to admit `shop_admin`.
Helper `public.current_user_is_shop_admin()` returns true for
`shop_admin` or `dev`.

### Project tracking (canonical: `0005_project_tracking_schema.sql`, `0006_seed_project_accounts.sql`)

Workflow: SAMO VP-Administration sends "หนังสือโครงการ" containing one or
more documents to a designated university officer ("พี่นิค"). Each document
has N attached files (Word / PDF / etc.) and an independent status; documents
within the same project may be sent days/weeks apart.

```
project_doc_types (text id PK, label_th, sort_order, is_active)
  ↳ seeded with 4 entries — admin can add more in-app
  ↳ types: หนังสือโครงการ / หนังสือเชิญอาจารย์ /
           หนังสือขอความอนุเคราะห์ sponsor / หนังสืออื่นๆ

projects (text id PK ["PRJ-YYMM-NNNN"], name, description, status,
          created_by, timestamps, is_public, fiscal_year_be)
  ↳ status IN ('open','in_progress','completed','cancelled')
  ↳ fiscal_year_be (migration 0165) is an OVERRIDE, not a copy: NULL means
    "derive the ปีงบประมาณ from created_at" (1 ต.ค.–30 ก.ย., named for the
    ending year), a number means a human moved it. Nothing backfills it, so
    a corrected created_at still re-derives. Settable by
    current_user_is_project_actor() — the ผู้ส่งหนังสือ + เจ้าหน้าที่คณะ
    audience — via projects_update. One implementation, in
    src/js/projects/fiscal-year.js, ratcheted by its .test.js.

project_documents (text id PK ["DOC-YYMMDD-HHMM-XXXX"],
                   project_id FK projects(id) CASCADE,
                   type_id FK project_doc_types(id),
                   title, note, sequence_no, status, return_reason,
                   sent_at, received_at, completed_at,
                   timeline jsonb, drive_folder, created_by, timestamps)
  ↳ status IN ('draft','sent','received','in_progress','returned',
               'completed','cancelled')
  ↳ unique(project_id, sequence_no) → "หนังสือ 1 / 2 / 3" per project

project_files (bigserial id PK, document_id FK CASCADE,
               file_name, drive_file_id, drive_view_url, mime_type,
               size_bytes, uploaded_by, uploaded_at,
               superseded_by FK project_files(id))
  ↳ replace = insert new + set superseded_by on old (non-destructive)

project_notifications (bigserial id PK, user_id FK users(id) CASCADE,
                       project_id, document_id, kind, body,
                       is_read, created_at)
  ↳ kind: 'sent','received','status','returned','comment',
          'file_replaced','completed'

project_files += sign_request_id FK project_sign_requests(id) SET NULL,
                 is_signed boolean default false   (migration 0050)
  ↳ the professor's signed output is a normal project_files row, flagged
    is_signed + tagged to the request it answers

project_sign_requests (text id PK ["SGN-XXXXX"], migration 0050,
                  document_id FK project_documents(id) CASCADE,
                  prof_id FK users(id), status, note, reject_reason,
                  file_ids bigint[], timeline jsonb, requested_by,
                  requested_at, decided_at, timestamps)
  ↳ status IN ('pending','accepted','rejected')
  ↳ เจ้าหน้าที่คณะ sends a SUBSET (file_ids) of a หนังสือ's files to the
    prof; he accepts (e-sign / reupload) or rejects (→ back to คณะ)

project_user_prefs (user_id PK FK users(id) CASCADE, migration 0165,
                  default_fiscal_year 'all'|'current'|'<4-digit BE>',
                  updated_at)
  ↳ own-row-only RLS in BOTH directions (USING + WITH CHECK), granted to
    `authenticated` only. An ABSENT row means 'all' — the behaviour the
    inbox had before the table existed. 'current' is resolved at OPEN
    time by src/js/projects/fiscal-year.js, so it rolls itself over on
    1 ต.ค. with nobody editing anything.

project_settings (singleton id=1, uni_staff_email, uni_staff_label,
                  vp_admin_label, notify_uni_in_app, notify_uni_email,
                  notify_vp_in_app, notify_vp_discord, updated_at,
                  + prof_email, prof_label, notify_prof_in_app,
                    notify_prof_email   (migration 0050))
```

Roles: `users.role` CHECK admits `vp_admin` (SAMO sender), `uni_staff`
(university officer receiver), and `sa_prof` (professor signer, migration
0050). **NO ACCOUNT HOLDS ANY OF THE THREE ANY MORE.** The shared logins that
did — `samomdkkuvpa` (retired 2026-08-17), `sastaff` + `saprof` (retired
2026-08-18, `tools/purge-shared-project-accounts.mjs`) — were deleted after
their work was reassigned; every actor is now a named person holding a ทีม SAMO
**project seat** (`vpa` / `staff` / `prof`, migration 0086), and every
project_* policy asks a seat-aware helper rather than the role. The role
branches stay in the CHECK and in the helpers as the pre-seat path; treat the
SEAT as the live channel. `auth.js registerWithPassword` still RESERVES
`sastaff` / `saprof` so a deleted staff username cannot be squatted.
Helper `public.current_user_is_project_actor()` returns true for `vp_admin`,
`uni_staff`, `dev`, or the `vpa`/`staff` seat — `sa_prof`/`prof` is
deliberately NOT an actor (narrow helper `current_user_is_prof()` instead).
It is also the gate on `projects_update`, and therefore the exact audience
allowed to move a โครงการ between ปีงบประมาณ (`projects.fiscal_year_be`,
migration 0165).

**Professor signing (migration 0050).** A third seat, `sa_prof`, signs
documents. uni_staff (+ dev) create a `project_sign_requests` row addressed to
the prof; the prof accepts (in-browser PDF e-sign via `pdf-lib`+`pdfjs-dist`,
or upload an externally-signed file) or rejects. uni_staff also gained file
add/replace/remove parity with vp_admin (file ops now notify the OTHER seat +
the prof when the doc has a sign request — `fanFileOp` in `inbox.js`,
`notifyProf` in `notify.js`). E-sign loads original PDF bytes via a new GAS
`getProjectFileData` action (Drive CORS) and is a lazy-loaded JS chunk.
Modules: `src/js/projects/{sign,esign}.js`, `src/html/modal-project-{sign,esign}.html`.
The professor's "only docs sent to him" scope is enforced in the UI
(`scopeProjectsForRole` in `index.js`, file filter in `loadFilesForDoc`), NOT
RLS — see the customer-mirror addendum below for why, and `mistakes.md`.

RLS: all six tables are gated to project actors. Both vp_admin and
uni_staff can SELECT + UPDATE projects + documents + files (the workflow
needs two-way writes); only vp_admin/dev can INSERT projects/documents
or DELETE. Notifications are scoped to `user_id = auth.uid()` for
read/update. `project_settings` write is vp_admin/dev only.

**Customer-mirror addendum (migration 0032, narrowed by 0114 + 0115).**
Four tables — `projects`, `project_documents`, `project_files`,
`project_doc_types` — additionally carry a
`*_read_public` policy `for select to anon, authenticated using (true)`
so the public `/projects-view` read-only mirror works for anonymous
visitors. Policies OR-combine so the actor-gated `*_read` policies
keep working for signed-in staff. Writes are untouched — still
gated to vp_admin / uni_staff. `project_notifications` and
`project_doc_views` are intentionally NOT publicised (they're per-
user state), and **`project_settings` is no longer public either
(0115)** — its row carries the officer's real `uni_staff_email`, and
the labels it was opened for were read by a function with no call
sites and the wrong column names. `mountCustomerProjects()` does not
fetch it. Customer mode in the JS module skips notification
mounts and no-ops `markDocSeen` so anonymous viewers never need
identity-keyed state.

**Per-row publish control (migration 0114).** `projects.is_public` and
`project_documents.is_public` (both `not null default true`) decide what
the mirror shows. The three public policies now read them:
`projects_read_public using (is_public)`, `project_documents_read_public
using (is_public and project_is_public(project_id))`, and
`project_files_read_public using (project_doc_is_public(document_id))`.
Both helpers are SECURITY DEFINER (an RLS inline subquery would be
evaluated under the caller's own policies) and `coalesce(…, false)` — an
id that does not resolve is NOT public. Hiding a โครงการ therefore hides
every หนังสือ and file under it whatever their own flag says. The default
is `true` because the mirror was already total; that is the opposite of
the safe default for a NEW public projection. Actors are unaffected —
`projects_read` / `project_documents_read` / `project_files_read` OR in
and ignore the flag, so a hidden row stays fully workable for staff.
⚠️ **This paragraph said "and for the prof it was sent to" until 0181, and
that was FALSE for three months.** `project_files_read`'s prof branch was
`prof_can_see_file(id)`, which answered by looking the row up in
`project_files` — so it could not see a row being INSERTed, and
`insert … returning` (PostgREST `return=representation`, which
`api.js createFile` uses) was refused. `project_files_read_public` was
covering for it on every published โครงการ, which is the only reason any
professor upload had ever worked: all 18 signed uploads in history were on
public โครงการ. Hide either flag and the อาจารย์ could still read, comment,
ยอมรับ and be notified — but not attach the signed file, after the PDF had
already reached Drive. **0181** moves the rule into
`prof_can_see_file(id, sign_request_id)`, which reads only the NEW ROW's own
columns; the 1-arg form is now a lookup wrapper that delegates to it so the
two cannot drift. Proof: `tools/proj0181-prof-upload.sql` (10 checks —
allow across four visibility states, deny, a CONTROL that re-runs them with
`project_files_read_public` DROPPED, and a differential over every existing
row). Write-up: `docs/mistakes/authz-rls.md`. Flipping the flag is sender-only
(`current_user_can_publish_project()` = role vp_admin/dev or the `vpa`
seat, now also the single authority behind the four insert/delete
policies); the BEFORE UPDATE trigger `project_public_flag_guard` on both
tables supplies the column guard that the row-level UPDATE policy cannot,
and `is_public` was added to `project_documents_prof_guard`'s immutable
list. UI: `isShownPublicly()` + the ซ่อน/แสดง buttons in
`projects/inbox.js`. Proof: `node tools/proj0114-visibility.mjs` (29
checks, allow + deny + cascade + actors + column guard).

Drive layout (lazily created by GAS on first upload):

```
My Drive/IT Database/Projects/
└── PRJ-2605-0001_<safe-name>/
    └── DOC-260526-1430-XXXX_<type>/
        └── <file>.pdf
```

Allow-listed: `uploadProjectFile` only writes under `Projects/...` and
rejects `..` segments.

### SAMO Team / org directory (canonical: `0046_team_management.sql`, seed `0047_seed_team_data.sql`)

The ทีม SAMO admin section (sidebar `data-admin-side="team"`) is an editable
org tree + people directory. Two tables:

```
team_nodes (uuid id PK, parent_id FK team_nodes(id) CASCADE,
            name, kind ['division'|'role' — TWO only since 0151],
            position int [sibling order], permissions text[] [app perm keys],
            inherit_permissions bool,
            color text [0152, hex-CHECKed, null = derive from the name],
            tier smallint [0153, 1..9, null = 1 — RANK inside the ฝ่าย],
            timestamps)
  ↳ tree depth is unlimited (defined purely by parent_id).
  ↳ `kind` is NOT cosmetic any more. 0151 folded 78 'department' rows into
    'division' (every one was a container) and the public chart now branches on
    it: seats sort above sub-ฝ่าย, and the "แสดงถึง" rungs are defined by kind
    rather than by depth. `src/js/node-kind.js` still READS a stray 'department'
    as a ฝ่าย (old bundle, old export); writers are normalised to the two.
  ↳ `tier` carries RANK so `parent_id` can go back to meaning CONTAINMENT: a
    ฝ่าย holds its seats FLAT, seats on one tier draw on one row, and tier k+1
    is drawn under the FIRST seat of tier k. Nesting a seat under a seat still
    works and still draws — tier removes the need for it, not the ability.
  ↳ permissions ∈ {pr,vs,samoshop,projects,creator,team,team_edit,passport,
    master} (the live list is `PERM_CATALOG` in `src/js/team-vocab.js` — RLS
    matches these strings, so a typo is a dead grant, not a crash). inherit
    walks up ancestors while inherit_permissions stays true.
  ↳ `team` is IMPLICIT since 0110 — `effective_team_permissions_for_email()`
    appends it for anyone with a posting, so it should never be STORED here.
    The form cannot write it (ticked+disabled in the grid, and `readPermInputs`
    filters `IMPLICIT_PERMS` on the way out); `tools/team0110-view-edit.mjs`
    asserts none is left stored, which doubles as a detector for a write path
    that forgets the filter.

team_members (uuid id PK, node_id FK team_nodes(id) CASCADE, position int,
              kkumail, full_name, nickname, student_id, major,
              cohort_year smallint, year_offset smallint  -- 0145, MIRRORED DOWN
              year text  -- DEAD since 0145; dropped once the bundle that
                         -- stopped reading it has been served for a while
              confirmed bool, user_id FK users(id) SET NULL [optional link],
              permissions text[] [per-person extras, 0081],
              inherit_permissions bool [also take the node's perms, 0081],
              photo_url text [PUBLIC portrait, 0103 — see the org chart below],
              timestamps)
  ↳ standalone directory rows — most members are NOT app login users.

team_majors (code PK [MD/MDI/RT], label, position int, timestamps)   -- 0113
  ↳ the vocabulary behind the สาขา picker, with add / rename-with-backfill /
    remove in the admin (each showing the PERSON count it touches first).
  ↳ RLS: read = any authenticated, write = `team_edit` only.
  ↳ **`team_members.major` is free TEXT with NO foreign key, deliberately.**
    Reference data with a DELETE is the fail-open class (see
    `.claude/rules/mistakes.md` class 2), so removing a สาขา only shrinks the
    picker — every person keeps their stored value, and an off-list value is
    re-added as its own `<option>` so saving an unrelated field cannot rewrite
    it.
```

**`prefix` (คำนำหน้า) was DROPPED from `team_members` AND `team_people` in 0113**
along with the three functions that named it and the CSV columns/aliases. It was
displayed nowhere and only ever produced spurious ตรวจสอบข้อมูล findings.

**One field vocabulary — `src/js/team/fields.js`.** รหัสนักศึกษา canonicalises to
`659999999-9` (bare 10 digits, Thai numerals and stray punctuation are all
normalised; anything else is REFUSED at the form, but only when the value
CHANGED, so an unrelated nickname edit is not held hostage by an unfixable id).
สาขา is a chooser. Three writers share the module — the admin form, the CSV
importer and the person's own card — because `io.js` previously carried its own
`normalizeYear` and the two drifted. Proof: `tools/team0113-fields.mjs`
(26 checks, both directions).

**ชั้นปี IS NOT STORED ANYWHERE (0145) — `src/js/study-year.js` computes it.**

```
ชั้นปี = ปีการศึกษา − ปีที่เข้า + 1 + year_offset
```

ปีที่เข้า is read off the รหัสนักศึกษา and re-derived whenever the รหัส moves
(`students_fill_cohort` 0128, `people_fill_cohort` 0145). ปีการศึกษา is
admin-set (`get_academic_year()`, 0141). `year_offset` is a DIFFERENCE — ลาพัก /
เรียนซ้ำ / จบช้า — which stays correct in every later year with no maintenance,
and survives a corrected รหัส unchanged because it is relative.

`cohort_year` and `year_offset` live on `public.people` and are MIRRORED DOWN
onto both placements (`students`, `team_members`) by `person_mirror_down`. They
are read-only on the placement: `team_members_self_update_guard` does not list
them, so a member cannot PATCH them, and a direct write is undone by the registry
on the next touch. The one writer is the person's own card, through
`update_my_identity` → `year_offset`.

**Nothing writes a ชั้นปี.** `team_members.year` was that column and it is dead:
nothing bumped it, so by August 2026 nine members were showing a ชั้นปี exactly
one year behind, and one person read ปี 5 / จบแล้ว / ปี 5 on three screens. The
CSV's `ชั้นปี` column is EXPORT-only and the import preview says so. Three
surfaces carry a ชั้นปี chooser (seat card, ระบบบ้าน admin, and the person's own
house card) and all three save the OFFSET; the ทีม SAMO admin form shows a
read-only computed box that repaints as the รหัส is typed.

Ratchet: `src/js/study-year.test.js` fails the build on any `year:` key in a
write payload, any second implementation of the arithmetic, and any ชั้นปี
rendered outside `studyYearLabel()`. Proofs:
`tools/team0145-one-chan-pi.sql` (16/16) and
`tools/team0145-save-as-the-member.sql` (12/12, impersonated).

**The tree DRIVES real login permissions (migration 0081).** A member's effective
app-perms = `member.permissions ∪ (member.inherit_permissions ? node_effective)`,
where node_effective walks ancestors per `inherit_permissions`. These flow to the
login gate via `public.users.managed_permissions text[]` — a SECOND, server-managed
permission channel kept SEPARATE from the manual `users.permissions` so the tree can
revoke its own grants without wiping manual ones. Both gates read the **union**:
`current_user_has_permission()` (RLS) `= perm = any(permissions) OR any(managed_permissions)`;
`userCanAccess()` (UI) checks both arrays. Delivery: `sync_my_team_permissions()`
(SECURITY DEFINER, granted `authenticated`, keyed off the caller's OWN
`users.email`=kkumail — no client input) is called in `auth.js buildCurrentUser` at
every login (auto-provision on first kkumail login); a statement-level trigger on
`team_nodes`/`team_members` (`*_recompute_perms`) rewrites `managed_permissions` for
every already-logged-in matching account on any perm/structure edit (live update, no
re-login). `managed_permissions` is guarded in `users_self_update_guard` (client PATCH
blocked; the two server writers pass via txn-local GUC `app.team_sync='1'`).

**ทีม SAMO view vs edit (migration 0110).** `team` is now the VIEW rung and
`team_edit` the WRITE rung; the 0089 `team_*_all_vp_dev` FOR ALL policy is
replaced by a `*_write` (role vp_admin/dev OR `team_edit`) and a `*_read` (those,
OR `team`) pair per table. **Membership grants VIEW implicitly**:
`effective_team_permissions_for_email()` appends `team` whenever the email
matches any `team_members` row, so it arrives through the one channel RLS,
`userCanAccess()` and `ADMIN_FEATURES` already read — no new access channel to
thread through five gates. Consequence, explicitly requested: all ~285 people in
the tree can read all ~404 member rows, including other people's `student_id`
and `kkumail`. The PUBLIC chart is unaffected — still the
`get_public_team_chart()` projection, and `team_members` still has no `anon`
policy.

A member may also correct their OWN row: `team_members_update_self` (own row by
`current_user_email()`, a definer helper so the policy does not depend on
`users`'s RLS) plus `team_members_self_update_guard`, a deny-by-default column
guard diffing `to_jsonb(row) - allowed_keys`, so only
`full_name/nickname/student_id/year/major/photo_url/photo_focus` are
self-writable and a column added by a future migration is guarded automatically.
The guard exempts the `app.team_sync` GUC — `sync_my_team_permissions()` writes
`user_id` on every login with a REAL `auth.uid()`, and without the exemption the
guard locks every non-editor out at login (see
`docs/mistakes/postgres-schema.md`). Proof: `tools/team0110-view-edit.mjs` (34
checks). UI: `canEdit()` in `team/index.js` renders no write affordance for a
viewer, and `get_my_team_seat()` returns the caller's own full record so the
public ตำแหน่งของฉัน card can show and fix it.

**`master` — one grant, every permission (migration 0111).** Taught to
`current_user_has_permission()`, the single predicate every permission gate
already calls, so all of them honour it with no new plumbing (the alternative —
OR-ing a `current_user_is_master()` helper into ~40 policies — is the class this
repo has paid for five times). `current_user_project_seats()` is the one helper
that reads a `managed_*` column directly and so needed teaching separately; it
returns all three seats for a master. VS scope, passport scope, shop admin and
`current_user_has_any_grant()` all already route through `has_permission`.

**It is a permission, NOT a role.** `current_user_is_staff()` is deliberately
unchanged — it is what `users_self_update_guard` trusts, so widening it would
let a master set `role='dev'` on themselves, a permanent escalation the tree
could no longer revoke. Three role-only surfaces therefore stay closed to a
master and this is correct: `users_update_staff` (editing other people's user
rows / role assignment), `notify_log_select_staff`, and
`reserved_staff_usernames_read_staff`. Proof: `tools/master0111-grant.mjs`
(30 checks — every gate open, the escalation refused, no spillover onto a
non-master). UI: `PERM_CATALOG` marks it `danger: true`, the grid confirms on
the way IN and shows the other keys ticked-and-locked while it is on, and
`readPermInputs` stores `['master']` alone so the implied keys can never be
unticked individually.

**Per-ฝ่าย VitalSound scope (migration 0082).** A node can be bound to ONE VS
department via `team_nodes.vs_dept` (one of the 11 `vs_tickets.target_dept`
values; picker in the node perm modal). It inherits down the tree on the same
`inherit_permissions` flag. A person's effective VS depts (from the nodes they
sit under) sync into `users.managed_vs_depts text[]` (server-managed, guarded,
carried by the same login RPC + recompute trigger). `sync_my_team_permissions()`
returns jsonb `{permissions, vs_depts}` now (was text[]). The `vs_tickets`
READ/UPDATE RLS (previously `vs_staff`/`dev` or `vp_admin` = own
`current_user_dept()`) gained two additive branches: `current_user_has_permission('vs')`
(full VS — this was MISSING from read/update before 0082, only delete had it) and
`target_dept = any(public.current_user_vs_depts())` (per-ฝ่าย scope). UPDATE WITH
CHECK lets a dept handler keep a ticket in their dept(s) or hand it back to SE —
never reassign to an unrelated dept. `userCanAccess('vs')` is true when
`managedVsDepts` is non-empty (opens the tab; RLS dept-filters the rows).

**Scope is part of the grant, not a sibling of it (migration 0083).** 0082's two
dimensions were independent, and a row carrying BOTH the `vs` permission and a
`vs_dept` was effectively unscoped — `current_user_has_permission('vs')` is an
unconditional OR-branch, and permissive RLS policies are OR'd. So the model is now
exclusive: a node/member carries EITHER `vs` (all depts) OR a `vs_dept` (that dept
only). The perm modal reveals the dept picker only once VitalSound is ticked and
drops `vs` when a specific dept is picked (`readPermInputs()` in
`src/js/team/index.js`); 0083 normalised the legacy both-set rows. 0083 also adds
`team_members.vs_dept` (per-PERSON scope, unioned with the node's, edited in the
สิทธิ์รายบุคคล modal) and one predicate every VS surface now asks —
`public.current_user_vs_scope()`: **NULL** = all depts (`vs_staff`/`dev`/perm `vs`),
**`{}`** = no VS access (fail closed), else the allowed `target_dept`s (a VP's
`users.department` ∪ `managed_vs_depts`). It backs the dedup RPCs
(`find_similar_vs_tickets`, `search_vs_tickets`, `merge_vs_tickets`,
`unmerge_vs_ticket`), `vs_hide_public_comment`, `soft_delete_vs_ticket` (which keeps
0044's "any ticket" rule for vs_staff/dev/vp_admin and scopes only the new path), and
the widened `vs_tags` read/write policies. Frontend mirror: `isVsSuper()` /
`vsScopeDepts()` in `src/js/vs-staff.js`. Proof script: `tools/vs0083-scope.mjs`
(run it after any change to VS RLS or these RPCs; it provisions a synthetic scoped
handler inside a rolled-back transaction, so it needs no live config).

**Board identity vs. board confidentiality (0084/0085).** A tree-scoped handler acts
for SAMO on the public Problem board, and the two halves are deliberately asymmetric:
the **badge** is global (`vs_post_public_comment` stamps
`is_staff = current_user_is_vs_handler()`, so their comments render as เจ้าหน้าที่
rather than the `นศ.XXXX` pseudonym — a badge carries no data), while **reading**
students' `staff_only` comments is dept-scoped (`get_public_vs_problem` ORs
`t.target_dept = any(current_user_vs_scope())` alongside the existing `v_staff` and
own-author branches). Reusing the global `current_user_is_staff()` for the read would
have recreated the 0083 bug one layer up. `current_user_is_vs_handler()` is
IDENTITY-only and must never gate dept-scoped data. 0085 makes it fail closed:
`current_user_is_staff()` returns NULL (not false) when the caller has no
`public.users` row, and `vs_public_comments.is_staff` is `NOT NULL`, so the NULL
would have made posting fail with 23502 — latent in 0072/0078 too.

**หนังสือโครงการ seats (migration 0086).** หนังสือโครงการ is not one capability but
three workflows, and the whole module branches on `users.role`
(`src/js/projects/index.js` → `currentRole`), so a flat `projects` grant to a
tree person (`role='user'`) opened the tab with NO controls and no write rights.
A node or member therefore carries a SEAT — `project_seat ∈ (vpa|staff|prof)`
(ผู้ส่ง / เจ้าหน้าที่คณะ / อาจารย์ ลงนาม) — resolved into
`users.managed_project_seats text[]` by the same login RPC + recompute trigger as
the other managed columns, and read by `current_user_project_seats()`. The two
role-only helpers are widened at their single definition each, so every policy
that already calls them inherits seats: `current_user_is_project_actor()` = role
vp_admin/uni_staff/dev **or** a seat of vpa/staff; `current_user_is_prof()` = role
sa_prof **or** the prof seat. A `prof` seat is deliberately NOT an actor (0050's
rule — the professor must not see unrelated projects). Frontend resolves the seat
to a role exactly once, in `projectSeatRole()`, so the module's ~40 `role === '…'`
branches are untouched; the UI refuses to save a `projects` grant with no seat.
Signing recipients come from `list_project_profs()` (id + display name only —
never an email), replacing `listUsersByRole('sa_prof')[0]`, and the sign modal
shows a picker when more than one อาจารย์ exists. Proof: `tools/proj0086-seats.mjs`.

**SAMO Passport admin grant (migration 0087).** Passport admin identity is granted
from the ทีม SAMO tree, not inside passport: tick **SAMO Passport** in จัดการสิทธิ์ and
pick a scope — ทุกฝ่าย (→ `permissions[] += 'passport'`) or a
department / sub-department (→ `team_nodes|team_members.passport_dept_id` /
`passport_sub_dept_id`). Resolved into `users.managed_passport_scopes text[]` as
tokens `d:<department_id>` / `s:<sub_department_id>` (a sub binding REPLACES the
dept token — it is strictly narrower). Scoped is not full, same rule as `vs_dept`:
choosing a specific scope drops the blanket `passport` permission, because
`current_user_has_permission('passport')` would be an unconditional branch.
The passport app reads **`public.passport_admin_context()`** — one definer call
returning `{is_admin, all_departments, departments[], sub_departments[]}` with ids
already resolved — and must not invent its own admin table. The picker's reference
list comes from `public.list_passport_departments()` because
`passport.departments` / `sub_departments` have RLS enabled with **no policy**
(0056), so a direct client read returns zero rows. Proof: `tools/pass0087-scope.mjs`.
⛔ **That deny-all is deliberate and must stay** — they are reachable only through
that definer RPC. `passport.continents`, which sits in the same reference-table
block of 0056, is the opposite case: it had NO row security at all until 0182 and
now has a read-only policy. So "make the passport reference tables consistent" is
an edit that would widen two definer-only tables to world-readable;
`tools/passport0182-continents-lockdown.sql` asserts both halves stay as they are.

✅ **CORRECTED 2026-09-06 — the write side is CLOSED.** This paragraph used to
say the bare `anon` role could insert activities, rewrite all 845 scan scores and
read all 593 profiles, and that per-department filtering was therefore cosmetic.
**All three claims are now false**, measured against the live database:

| Asked | Answer |
|---|---|
| write policies (`INSERT`/`UPDATE`/`DELETE`/`ALL`) open to `anon`/`public` with a `true` check | **0** |
| `profiles` rows readable by an unauthenticated caller | **0** — no `true` policy |
| passport tables with RLS enabled | **12 of 12** since 0182 (was 11 of 12: `continents` kept its GRANTs across the monorepo merge and lost its row security — `docs/mistakes/authz-rls.md`) |

What remains open to `public` is **SELECT on the board data** — activities,
seasons, scans, certificates, account_migrations — which is the public
activity board and is intended.

⚠️ It also pointed at `passport/SECURITY-HARDENING-PLAN.md`, which has never
existed at that path; the hardening it described was delivered as migrations.
**A stale vulnerability notice is not harmless**: it misdirects design ("filtering
is cosmetic, so why bother") and it published an alarm about a hole that was
already shut. Re-derive the current answer with `pg_policies` rather than
trusting this table — it is a snapshot, not a guarantee.

⛔ **One gap is open and is deliberately not described here** — the repository is
public. It is recorded in `docs/state/HANDOFF.md` §11 with the query that finds
it in one line.

**TWO VIEWS, TWO PARENTAGES, ONE ORDERING.** The public page offers แผนผัง (a
page of nesting ฝ่าย panels, `org-chart.js` + `org-chart.css`) and ผังรวม (one
d3 canvas, `org-graph.js` + `org-graph.css`). รายการ and ผังองค์กร were removed
on 2026-08-20 — each was a near-duplicate of a survivor (same markup / same
renderer), and a reader whose stored preference is one of them is MIGRATED
(`RETIRED_VIEWS` in `org-chart.js`), not reset.

แผนผัง draws the STORED tree (containment) and expresses ระดับ as ROWS inside a
panel; ผังรวม draws a REPORTING tree built by `chartParentage()` in
`src/js/org-rung.js` — a ฝ่าย's sub-ฝ่าย hang off its head seat, and `tier`
ranks the seats by NESTING. `org-chart.js` builds both indexes (`byParent`,
`byParentChart`) and runs `indexStats()` over each. **Do not unify the
geometries**: applying the reporting parentage to แผนผัง turned it into a
52,000 px staircase. **Do unify the ORDER** — both call `orderChildren()`
(ตำแหน่ง before ฝ่าย, ระดับ ascending), and `org-rung.test.js` holds the
differential that the seat sequence is identical either way. That differential
is the fix for "แผนผัง doesn't show order like the ผังรวม … it doesn't care
about ระดับ" (2026-08-20).

The search widens its kept set for the canvas only (`chartFilter`), because a
canvas ancestor can be a stored sibling.
Full reference: `docs/state-archive/2026-08-15-late-org-chart-reporting.md`.

**Public org chart — projection only (migration 0086).** `team_nodes.is_public`
(default true) marks a subtree as hidden from the future public org chart;
อาจารย์ / เจ้าหน้าที่คณะ hold seats but are not part of the student org, so their
roots are false. **The flag is not the privacy boundary.** The only sanctioned
publisher is `public.get_public_team_chart(year)` — SECURITY DEFINER, granted to
anon, returning a hand-built jsonb of node
`{id,parent_id,name,kind,position,is_board,color,tier}` + member
`{node_id,name,nickname,photo_url,photo_focus,position}` over a recursive CTE (so
hiding a parent hides its subtree). `get_public_org_chart()` still exists and is
now a one-line delegate to it, so there is exactly ONE body for the live
projection. Consumed by the public โครงสร้างองค์กร page (`/team` →
`src/js/org-chart.js`, 0103/0104); `photo_url` is therefore PUBLIC by
design for members of a public ตำแหน่ง — the admin member form says so. Never add a public SELECT policy to `team_members`
and never `returns setof public.team_members`: RLS is row-level, so a visibility
flag filters rows while every column — `kkumail` (students AND @kku.ac.th staff),
`student_id`, `year`, `major`, `permissions`, `project_seat`, `user_id` — travels
with them, and a `setof` return auto-exposes each column added later (cf.
`vs_tickets.tags` in 0079). `team_members` has no public policy today; anon reads
0 rows from it, and that must stay true.

**ปีการศึกษา + the archive (migration 0104).** The live tree is ALWAYS the current
term and carries no year column — deliberately, because `team_nodes`/`team_members`
feed the permission engine and a year-scoped row that still resolves is a live
grant to someone who left. Instead:

```
team_terms           (year PK, label, is_current, published_at)
                     partial UNIQUE index -> at most one is_current
team_archive_nodes   (id PK, year FK team_terms CASCADE, src_id, parent_id
                      FK self CASCADE, name, kind, position, is_board)
team_archive_members (id PK, year FK CASCADE, node_id FK archive_nodes CASCADE,
                      full_name, nickname, photo_url, photo_focus, position)
```

**Resolution order (0105)**: `get_public_team_chart(year)` serves a **published
archive** for ANY year including the current one; falls back to the **live tree**
only for the current term when nothing is published yet; otherwise empty. So the
public page shows exactly what the admin edits, and every published year is
editable. Once the current year is published, live-tree edits need a re-publish —
`team_term_status()` (admin-only) flags that as stale. `publish_team_term` carries
a photo forward when the live tree has none (**live > archived > null**, keyed on
`team_archive_members.src_member_id`, 0106), so the prompted re-publish cannot
delete portraits uploaded through the archive editor.

`publish_team_term(year)` (SECURITY DEFINER, `team` permission or vp_admin/dev,
guard uses `coalesce(...,false)` so a null role fails CLOSED) snapshots the
is_public subtree of the live tree, re-keying every node to a fresh uuid inside one
`AS MATERIALIZED` CTE — **that keyword is load-bearing**: inlined, each reference
would generate different uuids and every parent link would come back null,
silently flattening the archive. Re-running replaces the year wholesale. The
archive tables carry ONLY the columns the projection publishes, so an archived row
has nothing any resolver reads; they have **no public SELECT policy** (anon reads 0
rows) and are published solely through `get_public_team_chart(year)`. Past years
stay EDITABLE via the ทีม SAMO admin's third mode (`src/js/team/terms.js`), which is
the point of a snapshot rather than a view. `get_public_team_years()` lists only
terms that are current or published. Proof: `tools/team0104-terms.mjs` (27 checks).

**Portrait delivery.** `team_members.photo_focus` is an ENUM (`top|center|bottom`,
CHECK-constrained because the value is published and would otherwise reach CSS).
Uploads are downscaled in the browser to a 2400px WebP master
(`src/js/image-resize.js`) and filed in Drive under
`Team/<ปี>/<ฝ่าย>/<ลำดับ>-<ชื่อ>.webp` via the GAS `uploadTeamFile` action.
Rendering uses lh3 option strings — `=w<W>-h<H>-c-rw` gives a server-side crop to
the exact card aspect plus WebP (measured on a live file: 520x693 WebP = 37.6 KB,
vs 77.6 KB for the uncropped source a CSS crop would need). `focus != center` drops
the `-c` and crops in CSS instead, since lh3 has no focal point. Never append a
query string to an lh3 URL — it 404s (see mistakes.md).

RLS: **read + write for `vp_admin` + `dev` only**, every operation, via
`current_user_role() = any(array['vp_admin','dev'])`. No DEFINER RPCs — drag
reorder/move are plain PATCHes (parent_id + position); the frontend blocks
moving a node into its own subtree. RLS USING/WITH CHECK fail CLOSED on a null
role (only an explicit TRUE grants), so no null-role fail-open risk.

Frontend: `src/js/team/{index,api,realtime,io}.js` + `src/html/tab-team.html` +
`src/css/team.css`. Optimistic mutations (model+render first, then persist,
reload+toast on failure). Seed generated by `tools/extract-team-seed.py` from
`externaldata/roledata.xlsx` (people, 10 division tabs) + `previousroledata.json`
(tree order).

**Live multi-editor (migration 0048).** `realtime.js` subscribes to Supabase
Realtime postgres_changes on both team tables (RLS-filtered to vp_admin/dev).
Remote edits merge into the in-memory model and re-render (debounced; deferred
during a drag). Last-write-wins, not OT. The socket is re-authed every 20 min
because `db` runs with autoRefreshToken off. `currentAccessToken()` is exported
from `db.js` for `realtime.setAuth()`. (No presence indicator — the channel
stays open across admin sections, so a viewer count would include people who've
navigated away; the data sync is the value.)

**Import / export.** `io.js` (pure, unit-tested in `io.test.js`): JSON
export/import of the full tree+people (import is additive — new uuids,
parents-first) and members CSV (Thai header aliases, `path`-resolved roles with
optional auto-create). Export CSV ships a UTF-8 BOM so Excel renders Thai.

### Usage analytics (canonical: `0065_analytics.sql`)

```
analytics_events (id bigint PK, at timestamptz, session_id text [ephemeral,
                  sessionStorage — NOT a cookie], event text ['pageview'|'tab'],
                  path text, is_authed bool, user_id uuid nullable, referrer,
                  app text ['public'|'admin'])
```
Cookieless, anonymous. RLS: **anon + authenticated INSERT `with check (true)`;
staff-only SELECT** (append-only firehose, same threat model as `notify_log` —
per-column `char_length` CHECKs cap row size, `prune_analytics(days=90)` caps
row count). **Any renderer of its text columns must `escHtml` — the anon INSERT
makes `path` attacker-controlled even though a staff-only view reads it (see
`mistakes.md`).**

Two SECURITY DEFINER RPCs:
- `public_stats()` — granted to **anon**; returns curated aggregate COUNTS only.
  PR + VitalSound are split into `{pr,vs}_total` / `{pr,vs}_completed` (completed =
  `status like '%เสร็จสิ้น%'`, `deleted_at` filtered, migration 0066).
  หนังสือโครงการ (0067): `documents`, `doc_completed` (status='completed'),
  `doc_signed` (sign_requests 'accepted'), `doc_transactions` (SUM of doc
  `timeline` lengths), `doc_interactions` (comment notifs + doc views). Plus users,
  projects, new_users_7d/30d, departments. Powers the public landing strip
  (`src/js/home-stats.js` — count-up tiles + PR/VS/หนังสือ donut rings + activity
  chips). No rows/PII, so safe to expose.
- `analytics_overview(days)` — **staff-only** (guard fails CLOSED via `is not
  true`, and not granted to anon). Returns totals + signups/requests/visitors
  time-series + DAU/WAU/MAU (by session and by authed user) + top tabs + role
  split. Powers the admin สถิติการใช้งาน dashboard (`analytics-dashboard.js`).

Tracker: `src/js/analytics.js` (`initAnalytics('public'|'admin')`) sends
fire-and-forget events on load + tab/section switch; wired in `main.js` and
`admin-main.js` (the latter also `trackTab()`s from `showAdminSide`).

## RLS policies (canonical: same migration file)

- **users**: any authenticated user can SELECT all (needed for staff
  dashboards to render submitter names). UPDATE allowed on own row OR by
  staff.
- **announcements**: SELECT for everyone (incl. anon) where status =
  'approved'; all writes restricted to `pr_staff` / `dev`.
- **pr_tickets**: SELECT for submitter OR staff/dev **OR
  `current_user_has_permission('pr')`**. INSERT for anyone (guest submissions).
  UPDATE / DELETE the same: staff role **or the `pr` permission** (0014 — the
  permission channel, which a ทีม SAMO node grant produces).
  ⚠️ Deletion is a SOFT delete through `soft_delete_pr_ticket(text)`, a SECURITY
  DEFINER RPC (0043), because stamping `deleted_at` is an UPDATE and would
  otherwise inherit the broader UPDATE policy. **That RPC re-states the DELETE
  policy, so the two can drift — and did**: it was written from 0001's
  role-only rule and refused every permission-holder for 106 migrations until
  0149. `tools/pr0149-delete-permission.sql` asks the policy and the RPC the
  same question and fails if they disagree; `src/js/definer-authz.test.js` is
  its commit-time half.
- **vs_tickets**: same shape as pr_tickets (insert-open, mutate-staff). READ is
  dept-scoped: `vs_staff`/`dev` see all; `vp_admin` sees only `target_dept =
  current_user_dept()`; submitter sees own (0010).
  **Duplicate management (0068–0070, staff-side, additive — SE↔VP flow unchanged):**
  `duplicate_of` self-FK marks a ticket as a duplicate of a canonical one.
  Staff-only SECURITY DEFINER RPCs (fail-closed; `vp_admin` re-scoped to their
  dept since the definer bypasses RLS — see mistakes.md): `find_similar_vs_tickets`
  (pg_trgm suggestions), `search_vs_tickets` (free-text merge-target search),
  `merge_vs_tickets` / `unmerge_vs_ticket`. UI: "เรื่องซ้ำ" tab in the VS
  staff modal (`vs-staff.js`).
  **Duplicate = LINKED progress-mirror (0074), not a dead-end:** a duplicate B is
  a LINK to canonical A, and B's submitter sees A's progress mirrored, IDENTITY-BLIND.
  Trigger `vs_cascade_resolve` (fires on status OR resolution change) propagates A's
  `status` — and on close A's `resolution` (never the `resolution_note`) — onto its
  open duplicates, so B's stepper advances with A and shows the real outcome.
  `merge_vs_tickets` starts the mirror + adds a generic submitter-visible note (no id).
  Generated col `is_duplicate` (= `duplicate_of is not null`) is the ONLY duplicate
  signal exposed to submitters — `duplicate_of` is never returned to them (guest RPC
  nulls it; the owner read uses a `SUBMITTER_COLS` allow-list omitting it — closing the
  0071-only-covered-the-guest-path leak, see mistakes.md). "duplicate" is not a manual
  close reason (`MANUAL_VS_RESOLUTIONS`); duplicates go through merge only.
  **Submitter linked-context (0075):** `get_vs_linked_context(p_id)` (anon+auth, keyed by
  the ticket id capability) tells a duplicate's submitter, SAFELY: if the canonical is
  PUBLIC → its `public_id`+`public_title` (safe — already board-exposed) so the tracking
  view deep-links to the board (`vsOpenBoardProblem` → board mode + `vsBoardOpen`); if
  CONFIDENTIAL → only `{linked, related_count}`, never the id/title. Confidential-category
  re-checked in the RPC. Staff-only duplicate-cluster TREE (canonical→[dups], clickable)
  in the เรื่องซ้ำ tab (`renderDupTree`, `vs-staff.js`).
  **Resolution reason on close (0073, service-desk slice 2):** `vs_tickets` gains
  `resolution` (CHECK `fixed`/`forwarded`/`wont_do`/`duplicate`) + `resolution_note`
  (≤1000 chars). Set by staff when status→เสร็จสิ้น (required; `wont_do` also needs a
  note). Surfaces with NO RPC change to the owner read and the guest by-id lookup
  (`get_vs_ticket_by_id` returns the whole row). Submitter sees a friendly outcome card
  (`#dashResolution`) + a submitter-visible timeline remark. Shared label vocab:
  `src/js/vs-resolution.js`. No new RLS — the existing write policies gate it like `status`.
  **Public "Problem" board (0072, Phase 2):** `vs_tickets` gains
  `category`/`is_public`/`public_title`/`public_note` (SE-set, canonicals only);
  `vs_categories` (admin ref table, `is_confidential`/`public_eligible` flags, 6
  seeded), `vs_followers` (me-too, PK per user), `vs_public_comments` (moderated,
  length-capped). `vs_tickets` is NOT world-readable — the public surface is a set
  of SECURITY DEFINER RPCs returning a CURATED projection only (never raw problem/
  submitter/duplicate_of): `get_public_vs_board`, `search_public_vs` (similarity on
  `public_title` only), `get_public_vs_problem` (+ pseudonymous comments) — granted
  anon+authenticated; `vs_add_me_too`/`vs_remove_me_too`/`vs_post_public_comment`
  (kkumail, fail-closed on private/confidential); `vs_set_public` (SE-only, rejects
  confidential), `vs_hide_public_comment` (any-staff). Confidential categories are
  hard-excluded from every public read. UI: `src/js/vs-board.js` (board + detail,
  unified into the VitalSound tab as the default view) + SE publish panel in the VS
  staff modal. Isolation-proven: `tools/vs0072-isolation.mjs` (anon/kkumail/SE/vp).
  **Category = internal classification first** (2026-07-24): staff assign ANY
  category — confidential 🔒 included — via the "หมวดหมู่ (ภายใน)" select in the
  staff modal (single source of truth; publish panel only reflects it and blocks
  publish for confidential/none). Confidential categories exist to TAG sensitive
  tickets while the RPC join guarantees they can never reach the board. Taxonomy
  is deliberately ONE global SE-curated list — NOT per-department (dept is its own
  dimension via target_dept; per-dept lists would fragment the public board).
  **Internal per-department tags (0079):** a SECOND, orthogonal classification axis —
  INTERNAL and staff-only (the "one global taxonomy, not per-dept" rule above is about
  the PUBLIC category taxonomy; internal triage labels are a different concern). New
  `vs_tags` (id, `dept`, label, `color`, sort_order, is_active) + `vs_tickets.tags
  text[]` (loose refs, no FK — same choice as `category`; GIN-indexed). Tags are OWNED
  BY A DEPARTMENT so each dept classifies its own workload its own way. NEVER public:
  no public/guest RPC reads `vs_tags` or `tags`. RLS: read = `current_user_is_staff()`
  (vp_admin included, 0005); write (`vs_tags_write_scoped`) = vs_staff/dev/perm('vs')
  any dept, OR vp_admin where `dept = current_user_dept()`. Applied to a ticket via the
  same staff `vs_tickets` UPDATE path as `category` (no new ticket RLS). UI is
  admin-entry only (`src/js/vs-staff.js` + `src/html/modal-vs-tags.html`): a kanban tag
  facet scoped to the acting dept, a per-ticket toggle-chip editor scoped to the
  ticket's `target_dept` whose save MERGES with the ticket's other-dept tags (never
  drops them), per-dept-coloured card chips, and a per-dept tag manager (VP locked to
  own dept; super users get a dept picker).
- **pr_agents**: any staff role read; pr_staff/dev write.
- **shop_products / shop_pickup_batches**: public SELECT when
  `is_active = true`; admin (shop_admin or dev) full write.
- **shop_orders**: SELECT for buyer (own rows) or admin. INSERT for the
  buyer (`buyer_id = auth.uid()`) OR admin (0035 — walk-in/phone orders,
  buyer_id null). UPDATE allowed for admin always; allowed for buyer only
  while status is `pending` / `review` / `slip_mismatch`. DELETE admin-only.
  **The row policy is NOT the boundary for a buyer** — it is a row filter, and
  0100 found it let a buyer rewrite prices. The column boundary is the
  `shop_orders_self_update_guard` BEFORE-UPDATE trigger, which for a buyer
  self-update permits ONLY `buyer_phone`, `buyer_email` (added 0150), `slips`,
  `slip_url`, `slip_uploaded_at`, `status`, `timeline`, `updated_at`, and
  enforces an append-only timeline whose new entries may not claim an author.
  Everything else raises P0001. Buyer-facing writers: `addOrderSlip` /
  `removeOrderSlip` / `updateOrderContact` in `src/js/shop/api.js`.
  Proof: `tools/shop0150-buyer-contact.sql` — and note its subject must be
  MANUFACTURED, because every real order belongs to a shop admin and the guard
  returns early for one.
- **shop_order_items**: read/insert piggy-back on parent order's policy.
- **shop_settings**: public SELECT (so checkout can show the QR); admin
  write only.

Helper SQL functions: `current_user_role()`, `current_user_is_staff()`
(both `security definer set search_path = public`); plus
`current_user_is_shop_admin()` added in 0003.

## ระบบบ้าน (House) + student directory — migrations 0116–0118

Full design: `docs/HOUSE-SYSTEM.md`. Handover spec for the data:
`docs/house-data-spec-th.md`. Proof:
`node tools/db-query.mjs tools/house0116-authz.sql`.

### The person registry — `public.people` (0132–0134)

**One row per human, keyed on kkumail. This is the account system.** Identity —
name, ชื่อเล่น, รหัสนักศึกษา, สาขา, cohort, photo — lives here. PLACEMENTS point at
it and are NOT merged, because one person can hold several at once:

| Table | Is | Points at |
|---|---|---|
| `people` | the human | — |
| `students` | their HOUSE placement (`sai_code`, self_edited, import bookkeeping) | `person_id` |
| `team_members` | their ORG posting (node, term, permissions, confirmed) | `person_id` |

Promoted from `team_people` (0108), which was already populated and which
nothing in `src/` read.

**Three editors, one registry.** The person's own card writes
`update_my_identity()`; each admin pane writes its placement table and a mirror
UP carries it to `people`; `person_mirror_down` then carries it to the other
placement.

⚠️ **Both mirrors are guarded by `is distinct from`, and that guard is the
TERMINATION CONDITION** — without it the up/down pair recurses forever. It
converges in two hops. The guard compares the value a READER sees (for ชื่อเล่น
that is the GENERATED `students.nickname`, while the write targets
`nickname_self` — 0134).

⚠️ **`sai_code` and `node_id` are NEVER mirrored.** They are placement facts; a
mirror copying `sai_code` would move a student between houses from the ทีม SAMO
editor, silently.

**EXPAND-only.** Both placement tables still carry every identity column. The
CONTRACT step (retire them, one reader at a time) is planned in
`docs/PERSON-REGISTRY.md` and is NOT started. Views over `people` were
considered and rejected — they would need INSTEAD OF triggers plus
`security_invoker` on each. Proof: `node tools/house0132-registry.mjs` (19/19).

**ชั้นปี is DERIVED, never stored** (0131): `students.year_offset` holds the
DIFFERENCE from the cohort, ปีการศึกษา comes from the clock, and the arithmetic
lives only in `src/js/house/fields.js` — there is deliberately no SQL twin.

**The rule:** `house = the last digit of สายรหัส`. สายรหัส is 3 digits, **any
value `001`–`999`** — no ceiling is assumed and none is hardcoded. `sais` is
derived from the import (0121). The ten houses differ by at most one สาย at any
range. It is the UNIVERSITY's
อาจารย์ที่ปรึกษา assignment, random, and **not derivable from รหัสนักศึกษา** —
nothing may compute or repair one.

| Table | Notes |
|---|---|
| `houses` | Exactly 10, seeded 0–9. **UPDATE-only** — INSERT/DELETE revoked from `authenticated`, because the set is fixed by the rule. |
| `sais` | DERIVED from the import (0121), never seeded; `code` 3 digits. `house_id` is a **GENERATED STORED** column `(right(code,1))::smallint` — the single implementation of the house rule. Never write it. |
| `advisors` / `sai_advisors` | อาจารย์ as a person + a many-to-many link, so one advisor across several สาย de-duplicates in "อาจารย์ทั้งหมดในบ้าน". |
| `students` | ~1,800. Import-owned columns and self-owned columns are disjoint; `nickname` is a generated `coalesce(nickname_self, nickname_imported)`. |
| `student_change_requests` | The correction queue. Partial unique index allows one OPEN request per field per student. |
| `student_import_batches` | Audit of each import. |
| `house_settings` | One row: `sai_self_edit_open`. (`academic_year` vestigial since 0123 — it only fed ชั้นปี; `roster_visible` vestigial since 0124 — it gated a roster that no longer exists.) |

**RLS** — every table: `for all to authenticated using (role in (vp_admin,dev)
or current_user_has_permission('house'))`, plus an explicit
`revoke all ... from anon` (verified: anon gets 42501, not merely zero rows).
`master` (0111) satisfies the permission automatically.

**There is deliberately NO self-UPDATE policy on `students`.** A per-row UPDATE
policy is a row filter, never a column policy — the class this repo paid for on
`users` (0028), `vs_tickets` (0096) and `shop_orders` (0100). Self-writes go
through `update_my_student_record(jsonb)`, a definer RPC with a hard column
allow-list spelled out one field at a time.

**Self-edit boundary (0125)** — a student owns their ชื่อ · นามสกุล · ชื่อเล่น ·
รหัสนักศึกษา · สาขา, and **not** their สายรหัส (it decides the house; the route is
`request_my_change('sai_code', …)` and an admin approves). Because four of those
are import-owned columns, `students.self_edited text[]` records which ones the
person has taken over and a BEFORE UPDATE trigger (`students_keep_self_edits`)
preserves them on any write that stamps a new `last_import_batch` — so a
re-import cannot revert a correction, whichever code path runs it. Order is
**admin > student > import**. สาขา is validated against `team_majors`, the
faculty-wide picker vocabulary (write gate widened to `house` in 0125).

**RPCs** (all SECURITY DEFINER, all revoked from `anon`):
- `get_my_student_record()` — takes **no argument**; identity from `auth.uid()`,
  so it cannot be used to probe another address. Hand-built jsonb allow-list,
  never `returns setof students`.
- `update_my_student_record(jsonb)` — the self-edit allow-list. สายรหัส has its
  own gate: `sai_self_edit_open` (admin switch) AND `not sai_locked` AND
  `sai_self_edits < 1`.
- `request_my_change(field, requested, reason)` — files a correction for the
  caller only.
- **There is no house-roster reader.** `get_house_roster()` published every
  student in a house to any signed-in caller; 0124 DROPPED it. ระบบบ้าน names
  อาจารย์ (in their staff capacity, via `house_advisors` inside
  `get_my_student_record`) and never one student to another.
- `get_house_summary()` — the ten houses with member counts.
- `cohort_from_student_id(text)` — ปีที่เข้า from the first two digits of
  รหัสนักศึกษา (so the CSV never asks for it), bounded to 2540–2580 so a
  malformed id yields NO รุ่น rather than a plausible-looking wrong one. The UI
  labels it **รุ่น `MD{cohort−2515}`** (`cohortLabel`, src/js/house/fields.js).
  **ชั้นปี no longer exists in ระบบบ้าน**: `student_year()` was dropped in 0123
  along with its JS mirror, because it needed a clock and a per-student override
  and was ambiguous across years. `students.year_override`,
  `students.verified_at` and `house_settings.academic_year` survive as vestigial
  columns that nothing reads or writes.

**No date gates anywhere.** No reveal flag — an unnamed house *is* the
un-revealed state and renders as "บ้าน N". The whole feature works with zero
rows in `students`.

### The person registry and the roster import — 0132–0138

`public.people` is THE account table (0132): one row per human, keyed on
kkumail. `students.person_id` (house placement) and `team_members.person_id`
(org posting) point at it. Identity lives in the registry; PLACEMENT facts —
`sai_code`, `node_id`, term, permissions — never leave their own table and are
never mirrored. Three editors reach the registry: `update_my_identity()` (the
person's own card) and a mirror UP on each placement table (0133). All mirrors
are guarded by `is distinct from`; **that guard is the termination condition**,
not an optimisation.

**Names are stored as PARTS and the whole is DERIVED.** `first_name_th` +
`last_name_th` on `people`, `students` and — since 0135 — `team_members`, whose
`full_name` is filled by `team_members_sync_full_name()` whenever a part is
present. Nothing anywhere splits a combined name on whitespace: Thai surnames
contain spaces, and `src/js/name-split.test.js` fails the build on any module
that tries. Rows predating the split keep their combined name until a human
types a pair.

**`search_people(q, limit)`** (0137) backs the ทีม SAMO member picker — ชื่อ,
นามสกุล, ชื่อเล่น, รหัสนักศึกษา, สาขา, kkumail. Wildcards escaped, min 2 chars,
limit clamped to 50, identity-only projection, gated on
`team`/`team_edit`/`house`/vp_admin/dev, never `anon`.

**Import reconciliation** (0138). `students.self_edited` (0125) already recorded
which columns a person had taken over, and `students_keep_self_edits` preserved
them on an import; 0138 makes the discarded value visible instead of dropping
it. The rule: authority is per FIELD; silence is not agreement (a person who
never looked has claimed nothing, so the file writes); a disagreement becomes an
`identity_conflicts` row. `people.identity_confirmed_at` distinguishes "checked"
from "never opened the page". RPCs: `get_my_identity_status()`,
`resolve_identity_conflict(id, 'mine'|'theirs')` (choosing the file's value also
releases the column from `self_edited`), `confirm_my_identity()`,
`identity_check_summary()` (counts only — a list of names would be a roster
projection). `my_person_id()` is a definer helper used INSIDE the own-read RLS
policy, because an inline subquery over `people` inherits `people_read` and
would deny every ordinary student their own record.

⚠️ `identity_conflicts` needs its table GRANT as well as its policies — RLS
narrows a privilege that must exist first, and a policy set with no GRANT denies
everyone while looking exactly like the policies working.

**Frontend**: `src/js/house/` — `fields.js` (pure rules incl. the file-level
`auditSaiWidths` leading-zero check), `io.js` (CSV parse/diff/export),
`api.js`, `index.js` (admin workspace, section `house`), `my-house.js` (the
student's own card on the home page). Permission key `house` is threaded through
`PERM_CATALOG`, `ADMIN_FEATURES`, `PERM_SECTION`, `SECTION_META`, `SIDE_FEATURE`
and the sidebar.

## หน้าฝ่าย — a ฝ่าย edits its own page (migrations 0177–0178)

**Why it exists.** Every ฝ่าย page's content used to live in `DEPT_DEFS`, a
hardcoded object in `src/js/departments.js`: six ฝ่าย, of which exactly ONE had
any content. Changing a link was a commit plus a deploy by the owner.
`docs/DEPT-TOOLS.md` §12 predicted the shape and the cost — *content is DATA,
tools are CODE* — so 0177 moved the cards into a table.

| Piece | Where |
|---|---|
| The content | `public.dept_content` — `kind` is `'section'`, `'card'`, `'text'` or `'html'` (0179), ordered by `position`. `visible` hides without deleting, and a row added from the editor is created `visible=false` — a DRAFT — because it used to reach the public page half-built |
| The ฝ่าย list (identity: name, icon, colour) | `src/data/depts.js` — ONE home, read by the page, the editor and the grant picker |
| The public renderer | `src/js/dept-content.js` |
| The editor | `src/js/dept-page-admin.js`, pane `data-admin-pane="deptpage"` |
| The grant | `team_nodes.dept_page` / `team_members.dept_page` → `users.managed_dept_pages` → `current_user_dept_page_scope()` |

⛔ **A `kind='html'` row is rendered VERBATIM into an iframe `srcdoc` with a
sandbox that omits `allow-same-origin`** — an opaque origin, so it cannot reach
the session, the parent DOM, cookies or `localStorage`. **It is deliberately not
sanitised**: isolation is a property of the container, sanitising is a guess
about the content. Rendering a row's `html` into the page itself is the
vulnerability, not the absence of a filter. `dept-content.test.js` asserts this
on the RENDERED markup in both the page and the editor's preview.

⚠️ **What the sandbox does not stop:** an editor can publish a convincing fake
sign-in form on a real page. The controls are the grant and `updated_by`.

**The grant is the sixth scope dimension** and mirrors `vs_dept` exactly. The
blanket key `dept_pages` and the per-ฝ่าย list are **mutually exclusive** —
`current_user_dept_page_scope()` returns NULL (= every ฝ่าย) whenever the key is
held, so storing both makes the ฝ่าย choice decorative (0083). The eleven gates
a scope dimension has to be threaded through are itemised in
`docs/mistakes/authz-grants.md`. Proof: `tools/dept0177-page-scope.sql`.

**0178** taught `photo_reference_count()` about `dept_content.cover_url` and
`video_url`, so the portrait cleanup cannot delete a file a ฝ่าย page still uses.

**0179** widened `kind` to four values, ADD-only. `section` is a heading that
groups everything after it until the next one; `text` is a full-width paragraph
(`white-space: pre-line`, escaped — deliberately NOT a second markup path).
⚠️ Adding a kind touches FOUR places — the DDL check constraint, the branch in
`renderDeptContent`, `KIND_META` and `NEW_ROW` in the editor — and
`dept-content.test.js` derives the list FROM THE DDL and fails if any of the
other three has not kept up. An unknown kind falls through to the card branch on
purpose, which is what makes such a migration safe in either order.
Proof: `tools/dept0179-kinds.sql` (10 cases, 4 allow + 6 deny).

**The cover/video upload** goes through `uploadImageToDrive`, and the file a new
upload REPLACES is retired with the same `deleteTeamPhotoIfUnused` ทีม SAMO uses
— after the write is confirmed, never before. Nothing is uploaded when a file is
PICKED; see `src/js/dept-page-admin.js`'s `pending` map for the Drive orphans the
other order produces.

🧪 **A visual editor (GrapesJS 0.23.6, BSD-3, the only vanilla option — Puck and
Craft.js are React-only) is a SPIKE on the `html` kind** —
`src/js/dept-visual-editor.js`, admin-only and dynamically imported so its
1.15 MB never enters the public entry. Its output is plain HTML, which is why it
needed no new storage or isolation. Awaiting the owner's verdict; if the feel is
wrong it deletes cleanly.

## จองโควตา Claude — migrations 0154–0159

Booking a share of SAMO's ONE Claude Pro subscription. The stored unit is
**session percent**: a 5-hour session carries 100%, and the week carries 700%
(the owner's conversion — 1% weekly = 7% session, so a week is seven full
sessions). Nothing converts at read time.

**A session is DERIVED, not a slot on a grid.** Claude opens its 5-hour window
at the *first message*, so a wall-clock grid would be a fiction that reports
"both bookings fine" until the account caps out. Whoever starts first OPENS a
window; everyone whose block falls inside it shares that window's 100%.
`claude_sessions()` walks bookings in start order and opens a window only when
the previous one has closed — a block that begins inside somebody's window joins
it, even if it runs past the end.

**The rule the guard enforces (0159), in one sentence**: *for every window opened
in that chain, the bookings whose time overlaps `[open, open + 5h)` may not claim
more than 100% together.* It is a property of the SET, so it cannot depend on
insert order — which is exactly what 0154 got wrong. **There is no straddle rule
any more**: a block may cross a window boundary, because every window it touches
is checked to have room for it.

**The third anchor is the window that is already OPEN.** If the measurement says
a 5-hour window is running, that window is an anchor too, carrying Claude's own
reported utilization as its base load. So somebody who is already working cannot
be squeezed by a booking made afterwards — a late booking may only claim what the
open window has left. Nobody declares a session; the measurement is the signal.
Its one honest limit is that the sample is up to 15 minutes old.

**Tables**: `claude_settings` (one row: reset dow/time/tz, the two pools, the
session length — the reset is Wed 16:00 ICT but *configurable*, because
Anthropic sometimes resets early after an incident and a hardcoded anchor would
report a spent pool as full), `claude_bookings`, `claude_usage_samples`.

**Where each rule lives** — all four in the database, none in the form:
| Rule | Mechanism |
|---|---|
| ≤ 5 hours per block | `claude_bookings_span_max` check constraint |
| no two blocks overlap | `claude_bookings_no_overlap` **exclusion constraint** (gist over `tstzrange`) — two people pressing ยืนยัน at the same second both pass a client-side "is it free?" read |
| every 5-hour window ≤ 100% (including the one Claude says is open now), one week ≤ 700%, no straddling the weekly reset | `claude_booking_guard()` **trigger** — on the TABLE, so an import or a psql session passes through it too. It reads `claude_window_loads()`, which is the ONLY implementation of the window rule |

**Reads**: `get_claude_board(p_at)` returns the whole board in one payload —
week bounds, settings, bookings (each with its own `window_ends_at` /
`window_free_pct`), sessions, `right_now`, `free_windows` and the latest measured
sample. `claude_booking_limits(start, end, id)` is the second gated read: the
booking form calls it on a RANGE change (never on the slider — `max_pct` does not
depend on the pct asked for) to cap the slider, name who shares the window and
warn about a late start. One implementation, three readers.

⚠️ **`claude_free_now()` is a FOURTH reader of `claude_window_loads()`, and must
stay one (0161).** It answers "how much may I use right now, without booking",
which is the same question the trigger refuses with — so it asks
`claude_window_loads(null, t, t+1µs, 0)` which windows contain the instant and
takes the heaviest, exactly as the guard does. Until 0161 it derived its own
window from the CLOCK, and in the tail of any window a booking had opened it
offered a fresh 100% while the trigger refused anything over the real remainder.
`claude_free_windows()` walks it over the week for the calendar rail; its
boundary union must therefore include `booking_start + 5h` (the window's reset)
as well as `starts_at`, `ends_at` and `starts_at − 5h`. Guarded by
`tools/claude0161-rail-guard-parity.sql`, a differential over the whole week.

`claude_sessions()`,
`claude_window_loads()`, `claude_free_now()`, `claude_free_windows()` and
`claude_week_start()` are SECURITY DEFINER over the whole table and are
**revoked from `authenticated`** — only the trigger and the gated board RPC
reach them. The identity in the payload is a hand-built projection (name,
nickname, ฝ่าย path, ตำแหน่ง titles): since 0147 `public.users` is self-read
only, so no email, รหัสนักศึกษา, role or permission array is published.

**RLS**: permission key `claude`, one rung. SELECT for any holder; INSERT for
yourself only (`user_id = auth.uid()`); UPDATE/DELETE on your own row or
`master`. Threaded through `PERM_CATALOG`, `ADMIN_FEATURES`, `SIDE_FEATURE`,
`SECTION_META`, the sidebar and the landing card.

**Frontend**: `src/js/claude/index.js` (section `claude`),
`src/html/tab-claude.html`, `src/css/claude.css`. Week timegrid, windows drawn
as frames tagged "เหลือ N% · ถึง HH:MM", drag-to-select capped at 5h, ฝ่าย colour
from `dept-tint.js`. The week card states the three figures **ใช้ไปแล้ว / จองไว้ /
ว่าง** and sits ABOVE the "ใช้ได้เลยตอนนี้" hero on purpose. Two remembered view
switches: **พอดีจอ** (compress 24h to fit — sized from the scroller's CSS
`max-height`, never its `clientHeight`, which is a feedback loop) and **ใช้จริง**
(overlay the measured samples in a lane down the right of each day). A date
picker on the week label jumps weeks; a throttled refresh re-reads the database
(it cannot make the VM poll sooner). **ข้อตกลง** opens on first visit per
`TERMS_VERSION` and from the toolbar. Discord via `sendNotify('claude', …)` →
`notifyClaudeBooking` → `DISCORD_CLAUDE_WEBHOOK` in `/etc/samo-notify.env`.

**It coordinates; it does not enforce.** Everyone shares one login and can use
Claude outside their block — and the window model assumes people who book turn
up, which is why "จองแล้วเข้ามาใช้ และเริ่มให้ตรงเวลา" is rule 2 and 3 of the
ข้อตกลง rather than a nicety. The only *measured* number is
`claude_usage_samples`, written by `tools/claude-usage-report.mjs` — it reads
the OAuth token from `~/.claude/.credentials.json` and calls
`GET api.anthropic.com/api/oauth/usage`, which a browser can never do. Absent a
sample the board hides that strip rather than showing a zero.

**Proof**: `tools/claude0154-quota-guard.sql` (20/20, in `npm run proofs`).
**Guard test**: `src/js/claude/wiring.test.js`.

## Auth model details

- **Google OAuth**: routed through Supabase's `signInWithOAuth({ provider:
  'google' })`. Browser redirects to Google → Supabase callback → app.
  ⚠️ **Google Cloud Console only ever needs the SUPABASE callback**
  (`https://<ref>.supabase.co/auth/v1/callback`) — the browser never talks to
  Google directly. Where the app's own return URLs are listed is **Supabase →
  Auth → URL Configuration**, which must include `https://samo.md.kku.ac.th`
  and `http://localhost:5174` for dev. Any `*.pages.dev` entries still in that
  list are leftovers from the retired host.
- **Username/password**: synthetic email `<username>@samomdkku.app`.
  Supabase Auth treats it as an email-based account. The user only ever
  sees the username.
- **Email confirmation**: must be OFF in Supabase (synthetic emails don't
  receive mail). See `.claude/rules/mistakes.md`.
- **Staff seeding**: done. The three reserved usernames
  (`samomdkkupr`, `samomdkkuvssound`, `samomdkkudev`) were created via
  `admin.auth.admin.createUser` during the one-time Sheets cutover. If
  another staff seat ever needs to be added: do it from the Supabase
  dashboard (Auth → Users), then `INSERT` the matching row into
  `public.users` with the right role.

---

## Deploy plumbing

### One host: the KKU VM (Cloudflare Pages is RETIRED)

| What | Where |
|---|---|
| Production | <https://samo.md.kku.ac.th> — nginx on the KKU VM, built from `main` |
| Docs | <https://samo.md.kku.ac.th/docs> — **served from this VM**, built by `server/deploy.sh` with `DOCS_BASE=/docs/`. **A deploy is the only thing that updates it.** KKU issues no subdomain, so the path is the only official-looking address. **GitHub Pages publishes the same docs at the default base on every push** — the backup, so the VM is not a single point of failure, and the fresher of the two between deploys |
| `samomdkkuweb.pages.dev` | ⚠️ RETIRED **apex** — resolves, splash-redirects to the VM. **FROZEN since 2026-09-04**: production deployments are disabled on the Pages project, so pushing `main` no longer rebuilds it. A tombstone should not churn |
| `preview.samomdkkuweb.pages.dev` | ✅ **LIVE and useful** — the stable preview of `main`, rebuilt on every push by the `preview` mirror branch. Points at **samo-dev**, never production |
| `refactorsamomdkkuweb.pages.dev` | ❌ **DELETED 2026-09-04** (project and its 952 deployments). Does not resolve |

⚠️ **nginx must be told that `.mjs` is JavaScript, and `deploy.sh` does NOT
install nginx config — that is always a separate step** (`sudo cp
server/nginx-samo.conf /etc/nginx/sites-available/default && sudo nginx -t &&
sudo systemctl reload nginx`). The VM's `mime.types` has no `.mjs` entry, so it
fell through to `application/octet-stream`, and a browser REFUSES a module
script served with a non-JS type. The only `.mjs` Vite emits is pdf.js's worker,
loaded as `new Worker(url, {type:'module'})` — so the หนังสือโครงการ e-sign modal
was dead in every browser from the day it shipped until 2026-09-09, with zero
e-sign events ever recorded. The rule is a REGEX location above
`location /assets/` using `default_type` (a `types` block at that level REPLACES
the inherited map rather than extending it) and restating `Cache-Control`,
because a regex location wins over the prefix one. Guard:
`npm run check:asset-mime -- https://samo.md.kku.ac.th` — crawls the served HTML
through its chunks (the worker is three hops down) and fails unless it actually
checked at least one `.js` AND one `.mjs`. Write-up:
`docs/mistakes/deploy-hosting.md`.

⛔ **The `samomdkkuweb` PROJECT is alive; only its apex is retired.** Deleting it
would remove every preview, including the stable one above — the apex being a
dead URL makes the project look dead, and it is not. This is the single most
likely wrong conclusion to draw from this table.

⛔ **Do NOT move the preview onto the apex to "save a URL".** They do opposite
jobs: the apex is a tombstone for an address that spent months as production and
is still in bookmarks, chat history and autocomplete; the preview is a working
app on the DEV database. Serve the preview there and anyone arriving from a
stale link gets a site that looks real and writes nowhere. A ribbon saying
PREVIEW is a label; the redirect is a mechanism, and this project has already
had the ribbon fail to stop exactly that. `preview.` is the right home precisely
because it has no legacy traffic.

**A retired host is worse than a dead one**: it answers 200 with a page that
looks like the app, so verifying a deploy there reports healthy while production
is stale. Verify from the SERVED artifact on `samo.md.kku.ac.th` — and find the
bundle name in the served HTML, because the VM builds its own asset hashes.

Env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are baked in at build
time ON THE VM. A secret added to the Cloudflare dashboard reaches nothing.

Required env vars on both:
- `VITE_SUPABASE_URL = https://fheueuowbchsnsvbcgil.supabase.co`
- `VITE_SUPABASE_ANON_KEY = <anon key from Supabase Settings → API>`

Build config on both:
- Framework: Vite (or None)
- Build command: `npm run build`
- Output dir: `dist`

### Vaultwarden — the team password vault at `/vault/` (added 2026-09-05)

`https://samo.md.kku.ac.th/vault/` — a self-hosted, Bitwarden-compatible server
in a Docker container on the same VM, reverse-proxied by the site's own nginx.
**Operations, install and every trap: `skills/vaultwarden.md`.** This section is
the architecture only.

| Piece | Where |
|---|---|
| Container | `vaultwarden/server:1.37.2-alpine`, bound to **127.0.0.1:8788 only** — nginx is the sole way in |
| Data | `/opt/vaultwarden/data` (sqlite + `rsa_key.pem` + `attachments/` + `sends/`), root-only |
| Config | `/opt/vaultwarden/vaultwarden.env`, 600 — template `server/vaultwarden/vaultwarden.env.example` |
| Backups | nightly `OnCalendar` timer → `/var/backups/vaultwarden`, 14 kept; off-VM copy is `pull-backup.sh`, run by a human |
| Mail | Gmail app password on **`mdstuddata.beta@gmail.com`**, the role account that already sends SAMO mail |

**Why a PATH and not a subdomain.** KKU issues no subdomain — the same wall that
put the docs at `/docs` — and the VM cannot obtain its own public certificate,
because KKU's reverse proxy terminates `*.md.kku.ac.th` and forwards to
`https://10.101.111.181`, where nginx answers with a self-signed cert under
`server_name _`. A path on the main host is the only address available.

**The three settings that are load-bearing, all counter-intuitive:**

- `DOMAIN` **must carry the subpath**, and it re-prefixes routes INSIDE the
  container too — the health endpoint is `/vault/alive`, not `/alive`.
- The nginx `location /vault/` has a trailing slash; its `proxy_pass` must have
  **no URI part**, or the prefix is stripped and every API call 404s while the
  web vault still loads.
- **`SIGNUPS_DOMAINS_WHITELIST` must stay UNSET.** A non-empty value overrides
  `SIGNUPS_ALLOWED=false` and opens public registration to that whole domain.
  See `docs/mistakes/authz-grants.md`.

**Two host-wide changes came with it, and they help everything:**
`unattended-upgrades` is now installed and enabled (the box had never
auto-patched and was carrying ~90 pending security updates), and nginx now
actually compresses — `gzip on` alone covers only `text/html`, so a full
`gzip_types` + `gzip_proxied` + brotli were added. A cold `/vault/` load went
**8.26 MB → 2.26 MB**, and the main site's own bundle **293 KB → 112 KB**.

⚠️ **The vault holds the credentials to the box it runs on.** If the VM is down,
what you need to fix it is inside the thing that is down. The sealed break-glass
envelope is the mechanism, and it is the owner's to maintain.

### Apps Script projects (2)

- `prform` — owns the `PR` Drive folder + the SAMO Shop Drive
  tree (`Shop/Slips/...`, `Shop/Products/...`, `Shop/QR/`) +
  the projects email (MailApp). Add a new file-upload destination by passing
  a new `folderPath` prefix to `uploadShopFile`. (Its Discord actions are now
  dead code — Discord moved to the `/notify` proxy.)
- `vssound` — historically owned the per-dept Discord webhook map; that map
  now lives in the `DISCORD_VS_WEBHOOKS` Pages env var. The `.gs` is dead
  code pending its next redeploy.

Slim source files in `appscript/`. Redeploy procedure in `skills/deploy-gas.md`.

### GAS is a PUBLIC, mostly-unauthenticated API — treat it as one

Both Apps Script web apps are deployed **`Execute as: Me` + `Who has access:
Anyone`**, and their `/exec` URLs are inlined into the shipped bundle at build
time (`GAS_API_URL` in `config.js`; `VITE_GAS_UPLOAD_URL` for passport). So the
URL is **not a secret**, and every handler runs with the OWNER's full Drive and
Gmail authority for any caller on the internet.

These files read like internal helpers, which is why parameters kept getting
treated as trusted. **The dangerous shape is any handler taking an id or an
address** — the caller chooses the target. Current model:

| action group | authorization |
|---|---|
| uploads (`uploadPRFile`/`Shop`/`Team`/`Project`) | **open by design** — guests submit PR tickets without an account; bounded by per-action folder allow-lists |
| deletes (`deleteShopFile`/`ProjectFile`/`ProjectFolder`) | **folder-scoped only.** A Supabase-session gate was built and reverted — see below |
| `notifyProjectEmail` | recipient allow-list (`EMAIL_DOMAIN_ALLOWLIST` script property): an entry with `@` is a whole address, without one it is a domain. Every recipient checked, both matched exactly |
| passport `delete` | must live under `IT Database/Passport`, matched by folder **ID** |

**The session gate is staged, not active.** Verifying a token requires an
outbound HTTP call, and adding one changed the script's auto-derived OAuth
scopes (`script.external_request`). A web app runs as its OWNER, so until the
owner re-consents every execution throws an authorization error — which broke
all three deletes in production until it was reverted. Re-enable in this order:
(1) the owner opens the script, runs any function and accepts the new consent
screen; (2) then restore the gate and redeploy. The frontend already sends
`accessToken`, so step 2 is the only code change.

Rules when touching these: verify a token server-side, never by decoding the JWT
locally (decoding needs the signing secret, and parsing the payload accepts any
forgery); fail **closed** on errors; when adding a newly-required field **ship
the frontend first** (an old script ignores an extra JSON field, so it is a
no-op until GAS follows, whereas the reverse breaks every served bundle); and
before adding ANY new Google service to a script, check whether it widens the
derived scopes — if it does, the owner must re-consent BEFORE the deploy.

### Drive folder layout (lazily created by GAS on first upload)

```
My Drive/
└── IT Database/                   ← APP_ROOT_FOLDER_NAME: everything GAS
    │                                 touches is mounted here, so the SAMO
    │                                 Drive root stays browsable
    ├── PR/                        ← PR ticket attachments (uploadPRFile)
    ├── Projects/                  ← หนังสือโครงการ (uploadProjectFile)
    ├── Team/                      ← member portraits (uploadTeamFile)
    └── Shop/                      ← Shop assets (uploadShopFile)
        ├── Slips/
        │   └── YYYY-MM/           ← monthly partition: keeps any one folder
        │                             well under Drive's per-folder cap
        │       └── <buyerId>_<ts>.jpg
        ├── Products/
        │   └── <productId>/
        │       └── <name>_<ts>.jpg
        └── QR/
            └── promptpay_<ts>.png ← admin-uploaded PromptPay scan
```

`badges/` + `certificates/` under `Passport/` are written by the **passport**
repo's own Apps Script (`gas/Upload.gs`) — a separate project pointed at the
same container by name, not by a shared folder id.

`uploadShopFile` is allow-listed: it only writes under `Shop/...` and rejects
`..` segments. Folders are created lazily on first write.

**The mount point and the folder names are server-side only.** The frontend
passes root-relative logical paths (`Shop/Slips/2026-05`) and
`getOrCreateTopFolder_` in `prform.gs` resolves the first segment, so no client
knows about the container. `TOP_FOLDER_CANON` maps every legacy spelling
(`PR_Submissions`, `SAMO_Shop`, `SAMO_Team`) to its canonical name — it is both
the rename map and the transition allow-list, so an old bundle in an open tab
still uploads. **Don't drop a legacy key while any deployed bundle can send it.**

The resolver folds LOCATION and NAME migration into one search — app
root/canonical, app root/legacy (rename), My Drive root/canonical (move), My
Drive root/legacy (move + rename), create — first hit wins, create is last
resort. Move and rename both preserve the folder id and every file id inside,
so no stored URL ever changed. `migrateDriveLayout` / `inspectDriveLayout`
(editor-only, no `doPost` route) do it deliberately for all four.

Two things that must track any future rename: `fileLivesUnderTop_` walks the
ancestry BY NAME and gates every file delete, and `findTopFolder_` is the
non-creating lookup used by delete paths. Both canonicalise through the same
map. Any new top-level folder must resolve through `getOrCreateTopFolder_`,
never `DriveApp.getRootFolder()`.

### Supabase project

- Region: Southeast Asia (Singapore)
- Free tier (1 GB DB + 1 GB storage — we use Drive for files instead)
- Auth providers enabled: Email (synthetic), Google OAuth
- URL Configuration must include `https://samo.md.kku.ac.th` + localhost
- **Migrations applied: everything in `supabase/migrations/`, in order.**
  ⚠️ This line used to enumerate `0001`–`0006` by name, and stood while the
  directory grew past 160 files — a list that has to be edited by hand every
  time is a list that stops being true. `ls supabase/migrations | wc -l` counts
  them. ✅ **The applied high-water mark now lives in the DATABASE, not in a
  document** — `public.schema_migrations` (migration `0169`) exists on both
  projects since 2026-08-27. **Ask it, do not read a number out of a file:**
  `npm run migrate:status` (add `--dev` for `samo-dev`; the default is
  PRODUCTION on purpose, and it prints which one it chose).
  ⚠️ **`backfilled` is not `applied`**: backfilled means the file predates
  tracking and no apply time was ever observed. Only rows written by
  `apply-migration.mjs` carry a real timestamp.

---

## Notable design decisions

- **Drive for files, not Supabase Storage**: 2 TB vs 1 GB free tier.
- **A dedicated `/notify` proxy for Discord, not GAS**: ALL Discord
  notifications (PR/VS/projects) go through `/notify`. A dedicated egress IP
  (vs GAS's shared one) removes the 1015 per-IP rate limit and gives real logs.
  ⚠️ **In production that proxy is the `samo-notify` Node service on the KKU VM**
  (`server/notify-server.mjs`, systemd unit `samo-notify`, nginx proxies
  `/notify` to `127.0.0.1:8787`, webhooks in `/etc/samo-notify.env`).
  `functions/notify.js` is the Cloudflare-Pages twin of the same handler — kept
  because the two must stay behaviourally identical, and because a preview
  environment would use it (`docs/TEAM-WORKFLOW.md` §5). Setup + rotation:
  `server/setup.sh`; the Pages-era procedure is in
  `skills/cloudflare-notify-function.md`.
  (Supabase Edge Functions were the earlier candidate but 502'd in this
  project.)
- **GAS = Drive uploads + projects email only** now: the 2 TB Drive quota is
  the one thing nothing free beats, so uploads stay on GAS; Discord moved off.
- **Raw `fetch` via `dbRest()` for hot paths**: supabase-js has been a
  source of intermittent hangs. The raw-fetch escape hatch is used in
  pr-form, vs-form, pr-tracking, announcements.
- **Disabled autoRefreshToken**: replaced with a 25-min `setInterval` in
  `db.js`. Avoids inline refresh stalling the next user action.
- **setTimeout(0) wrapper in onAuthStateChange**: workaround for supabase-js
  auth-lock deadlock (issue #762).

---

## Developer workflows

### The frontend ↔ backend boundary

There are three boundaries the SPA crosses, in descending order of frequency:

1. **PostgREST (Supabase)** — almost all reads/writes. Auth is automatic via
   the `sb-<project-ref>-auth-token` cookie/localStorage entry. Either use
   the supabase-js client (`db.from('table')...`) OR the raw-fetch helper
   `dbRest('/table?...')` from `src/js/db.js`. Prefer `dbRest()` for any
   hot path — supabase-js has known intermittent hang modes
   (see `.claude/rules/mistakes.md`).
2. **Supabase Auth** — `db.auth.signInWithOAuth({ provider: 'google' })` for
   Google, `db.auth.signInWithPassword({ email, password })` for username
   accounts. `db.auth.onAuthStateChange()` callbacks MUST wrap their body
   in `setTimeout(() => ..., 0)` to escape the GoTrue lock deadlock (issue
   #762). Don't touch this without reading mistakes.md.
3. **GAS `/exec`** — only for `uploadPRFile` (Drive upload) and the three
   Discord-notify actions. Always `fetch(url, { keepalive: true, ... })` —
   do NOT use `sendBeacon` (doesn't follow GAS's mandatory 302 redirect).

### State management

There is no state framework. Pattern:

- **Auth state** lives in `src/js/auth.js` as a module-scoped `currentUser`.
  Subscribe via `subscribeToAuth(callback)`. Callbacks fire on real
  transitions (sign in, sign out) AND on token refresh — gate any UI
  side-effects (e.g. `showAdminLanding`) behind a `prevAuthKey !== nextKey`
  check, otherwise the kanban will reset on every token refresh.
- **Form state** lives in the DOM (`<input>` `.value`). Hidden inputs are
  re-populated from `authGetUser()` after every `form.reset()` because
  reset clears them too (see `docs/mistakes/frontend-ui.md`).
- **Tab state** is Bootstrap's. We listen for `shown.bs.tab` to close
  parent dropdowns that Bootstrap left open.
- **Server state** is fetched on-demand per panel. No client cache. The
  kanban / dashboards refetch on every open. Reads are fast enough at our
  scale (low hundreds of rows) that caching isn't justified.

### Testing locally

There is no automated test suite. The reproducible smoke tests in `STATE.md`
are the regression bar — exercise them after any auth, network, or form
change.

**Mocking external services:**

- **Supabase**: we don't mock it — **use `samo-dev`.** ✅ **Corrected
  2026-08-27: this line used to say "the real dev project (same as prod
  currently — there's no separate dev branch)", and that stopped being true the
  day a dev project was built.** There is now a separate Supabase project on a
  separate account, holding a full copy of production — same schema, same data,
  same permissions, same RLS. Credentials are the two shareable `SUPABASE_DEV_*`
  lines (the ACCESS_TOKEN and DB_URL are migration-only since 2026-09-06) in
  `.env.local`. `CONFIRM=1 npm run dev:refresh` rebuilds it from production;
  `npm run dev:check` proves it still answers the way production does.
  ⚠️ **It holds REAL student data** (a deliberate decision — `docs/TEAM-WORKFLOW.md`
  D1), so never publish the URL and never let a real name or รหัส reach a
  commit, a fixture or a screenshot: this repository is public.
- **Discord webhooks**: don't fire them during dev. Either:
  - Toggle the `silent_notify` flag on the PR form (dev-role only), OR
  - Temporarily point `GAS_API_URL` in `src/js/config.js` at a no-op GAS
    deployment, OR
  - Point the Apps Script `DISCORD_WEBHOOK_URL` Script Property at a private
    test channel and redeploy.
- **Drive uploads**: same project as prod. Files go into `PR/`
  in the GAS owner's Drive. Test files accumulate there — clean up
  periodically.

There is no record-and-replay or local Apps Script emulator. The lowest-cost
loop is a real submit against the real backend with a `_test_` prefix in
the content.

### When you suspect supabase-js is hanging

Switch to `dbRest()`. It's a raw-fetch + AbortController wrapper against
PostgREST with the same auth headers supabase-js sends. Used today by
`pr-form.js`, `vs-form.js`, `pr-tracking.js`, `announcements.js`.

```js
import { dbRest } from './db.js';
const rows = await dbRest('/pr_tickets?id=eq.PR-XYZ123&select=*');
```

If the symptom is "hangs only after sign-in", check `auth.js` —
`onAuthStateChange` body must be inside `setTimeout(() => ..., 0)`.

### When you change the schema

1. Add a new numbered file under `supabase/migrations/` (e.g.
   `0003_add_priority_column.sql`). Don't edit `0001_*` in place.
2. Apply it via the Supabase SQL editor (or Supabase CLI if you have it
   wired).
3. Update the Tables section of `docs/CONTEXT.md` and the RLS section if
   policies changed.
4. If the change is breaking (column rename, type change), update affected
   queries in `src/js/*.js` and audit `dbRest()` paths.

### When you add a new department or role

- Departments are enumerated in `src/css/base.css` as `--dept-*` variables.
  Add the new key there for color theming.
- Department keys are referenced as strings in `pr_tickets.department` /
  `vs_tickets.target_dept`. There is no enum on the DB side — strings are
  free-form, so **the option value IS the stored value**.
- **PR**: add it to `PR_DEPARTMENTS` in `src/js/pr-depts.js` — that one list
  fills BOTH the submit form's ฝ่าย select and the admin staff dept filter
  (`fillPrDeptSelect`), so it cannot go half-applied. Those two `<select>`s
  used to be hand-written in `tab-pr.html` / `tab-admin.html` and had drifted
  (shared typo, missing ฝ่ายรังสีเทคนิค, โครงการอื่นๆ in only one of them).
  Never RENAME an existing entry in place: historical rows keep the old
  spelling and would drop out of the dept filter. Add the old string to
  `DEPT_ALIASES` instead — `canonicalPrDept()` is applied at the DB-row →
  view-model boundary in `pr-staff.js` / `pr-tracking.js`, so display and
  filtering agree while the stored column is left untouched.
- **VitalSound** keeps its own parallel list (`อุปนายกฝ่าย…` values, plus
  `นายกสโม` / `SE`): `VS_DEPTS` in `src/js/team/index.js`, the selects in
  `tab-vitalsound.html` / `modal-vs-staff.html` / `modal-vs-tags.html`, and
  `DEPT_META` in `vs-staff.js`. The two lists are deliberately different —
  PR routes by ฝ่าย, VS routes by the อุปนายก who owns the complaint.
- Roles are in `users.role` (CHECK constraint). Adding a role requires a
  migration to extend the CHECK constraint AND updating
  `current_user_is_staff()` / RLS policies that reference roles.

---

## When this doc goes stale

It WILL drift. Trust the code over this doc when they disagree:

- Authoritative schema: `supabase/migrations/0001_initial_schema.sql`
- Authoritative auth flow: `src/js/auth.js`
- Authoritative deploy config: `server/deploy.sh` + `server/nginx-samo.conf` on
  the KKU VM, plus `appscript/*.gs` deployment dropdowns.
  ⚠️ **This line used to say "Cloudflare Pages dashboard", in the section about
  this document going stale.** That dashboard reaches nothing — Pages is
  retired. A doc that names the wrong authority is worse than one that names
  none, because the reader stops looking.
