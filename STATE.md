# STATE — what is true RIGHT NOW

**Split 2026-08-27.** This file was 1,403 lines against a ~200-line target
because it held three lifetimes at once. It now holds one: **status**.

| Looking for | It is in |
|---|---|
| rules that outlive a session | **`docs/INVARIANTS.md`** |
| what a past session did, and why | **`docs/state-archive/`** — newest `2026-08-27-state-split.md` |
| what one person is working on | `docs/state/<github-handle>.md` |
| the chronology | `git log --oneline` |
| bugs already paid for | `docs/mistakes/*.md`, indexed by `.claude/rules/mistakes.md` |
| architecture, RLS, schema, deploy | `docs/CONTEXT.md` |
| the backlog | `docs/NEXT.md` |

## HOW TO EDIT THIS FILE

Everything older was drained on 2026-09-01 (and the 09-01 "settled" list on
09-05, after confirming each pointer resolves) — reasoning in
`docs/state-archive/2026-08-30-status-prune.md`, durable items in
`docs/INVARIANTS.md`.

**Rules for editing this file, each paid for:** give a decaying fact ONE home ·
grep the WHOLE file before correcting anything · never touch the deploy block
unless you deployed · **do not append a session narrative** — write
`docs/state/<your-handle>.md` instead, and never rewrite someone else's.
`state-handoff.test.js` pins what is mechanically checkable (dead pointers,
disagreeing counts, this file's length); it cannot judge whether a sentence is
TRUE. That is what the grep is for.

---

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `a6789e8` (2026-10-31 13:06 Thai — docs + comments sweep: INVARIANTS now says ONE org view (served `/docs/INVARIANTS.html` greps `ONE view, ภาพรวม`), dead `GRAPH_SHAPE` removed, two unreleased changelog notes corrected; `DEPLOY_EXIT=0`; VM HEAD read back. Before it `4efb262` (2026-10-31 12:54 Thai — docs only: HANDOFF §33 + three write-ups; `6b936f0` (2026-10-31 12:49 Thai — /me holds the account settings inline (no public profile modal; admin keeps it) and เกี่ยวกับเรา shows only ภาพรวม (org-graph.js + d3 removed); no migration; served `/me` has `id="meSettings"` + `id="meAccount"` and 0 `profileModal` / `orgExpandAll`, `public-De1DjKy7.js` greps `me-set-row` + `โครงสร้างทั้งหมด` and 0 `data-org-view`, `/admin/` still has `profileModal`; `DEPLOY_EXIT=0`; VM HEAD read back. Before it `eefcd80` (2026-10-31 12:17 Thai — ระบบบ้าน: a failed claim hands over everything, สาย included (0268, applied to production FIRST, house0268 30/30 + house0191 28/28 there); served `core-DwXnmrAn.js` greps `submit_my_house_details` + `ช่องทางที่เคยติดต่อกันอยู่แล้ว` with control `claim_my_student_seat`, `admin-DqW0WxKL.js` greps `ตรวจแล้ว เพิ่มเข้าระบบบ้าน`; `DEPLOY_EXIT=0`; VM HEAD read back. Before it `34fe095` (2026-10-31 11:47 Thai — Passport dates read dd/mm/yyyy (served `admin-CHEkzdaw.js` greps `วว/ดด/ปปปป`) and the Passport quarter controls moved to `/admin/#years` (served `samo-year-admin-8XSazt-T.js` greps `syPassport`; `/passport/html/admin.html` has the `/admin/#years` link, no `seasons-section`); `DEPLOY_EXIT=0`; VM HEAD read back. Before it `9c94924` (2026-10-31 10:57 Thai — docs only: HANDOFF §2 shipped, served at `/docs/state/HANDOFF.html`; `DEPLOY_EXIT=0`. Before it `7766194` (2026-10-31 10:55 Thai — Passport event date + scan window (0267, applied to production FIRST) and the portal/Passport icons + link-preview card; served `/passport/html/admin.html` loads `admin-D3zCaXS4.js` which greps `activity_date_info` + `ตั้งวันหมดอายุ QR เอง`, `scan-CnHXYtdi.js` greps `SCAN_EXPIRED`; `/` serves `og:image` + `/favicon.svg` byte-identical to the repo's reverse mark; `DEPLOY_EXIT=0`; VM HEAD read back. Before it `6d09d62` (2026-10-30 — docs only: the archived deploy chain served at `/docs/state-archive/2026-10-30`; `DEPLOY_EXIT=0`. Before it `a137a1a` (2026-10-30 — แลก Rotation: off-criteria words in one table, dead classes fixed, docs caught up to 0255–0266; served `/rotation` loads `page-B9ykcWkE.js` which greps `rot-accent` + `ทักคุย/ขอแลก (>0.3)` with control `rotation_contact_email`, and 0 `btn-xs`/`rot-alert-footer`; `public-*.css` serves `.rot-accent{color:var(--brand-primary)}`; `/var/www/docs` published the same minute; `DEPLOY_EXIT=0`; VM HEAD read back. Before it `20c23f5` (docs only). Earlier deploys, each with what it served: `docs/state-archive/2026-10-30.md`.)** The sha is read from the VM's
  own HEAD, not retyped. `<== exit 0 — ran to the end` + `DEPLOY_EXIT=0`. Since `c7412f2`: credential rotation (2026-09-25 — Supabase keys now `sb_publishable_`/`sb_secret_`, legacy JWT keys off, HS256 revoked; 12 leaked webhooks replaced, old ones 404), the new welcome banner, and the `no-secrets-in-git` guard. Then `f6cef24`: a preorder's stock grid is a limit (0209); `9e9cba8`: preorder and in-stock have separate tables (0210); `69f3f5e`: the สต็อก tab shows both tables per card. Then `3345f94`: /admin/ → บัญชีผู้ใช้ (0211, master only) + Google accounts no longer stored as 'password' — served chunk greps `account_dashboard_pulse`. Then `d61c781`: every row, 8 filters, 14 sorts (served chunk greps `สมัครภายใน`); `7a10e46`+`115deac`: night agent by the window + the usage snapshot for it. `5eeda54`: the `migrations` CI replay was RED from 3345f94 (stub lacked a column 0211 reads) — green again; `8c72bf9`: `handoff:check` now fails on any CI workflow red on main. Browser smoke 18/18. Write-ups: `docs/mistakes/integrations.md`. Previous: `c7412f2` (`docs/state/claude-2026-09-23.md`).
- ✅ **`main` being AHEAD of the deployed sha is the NORMAL state** — tests and
  session notes reach nothing. ⚠️ **`docs/` DOES ship now** (the VM serves
  `/docs`), so "it is only docs" stopped being a reason to skip a deploy on
  2026-08-31. Do not judge by eye and do not retype the sha: **`npm run
  deploy:owed`** reads the ✅ DEPLOYED line above — the sha's only home — and
  compares it with the WORKING TREE. ⛔ **Never paste a `git diff <sha>..HEAD`
  snippet back in**: the sha had four homes here and one got corrected.

- ⚠️ **Verify from the SERVED artifact**, and grep the RIGHT one — both traps
  live once, in `docs/INVARIANTS.md` and `docs/mistakes/deploy-hosting.md`.
- **Apps Script = prform v16** (2026-10-14, `/exec` unchanged; detail HANDOFF §22)
  — year folders + a REAL-top-folder gate. v12 added the two read-only handlers §13a needs. ⛔ Calling them hard degrades the endpoint
  real uploads SHARE; measured in `docs/state/HANDOFF.md` §13a.
- **Migrations through 0270 (0270 = ทีม SAMO years built by hand + shown on เกี่ยวกับเรา, publish refuses to rebuild a hand-built year — written 2026-10-31, NOT yet on production; 0269 = หนังสือโครงการ Drive folder follows the ปีงบ: `projects.drive_year_be` records where the folder IS — written 2026-10-31, NOT yet on production; 0268 = ระบบบ้าน: a failed claim opens a form for EVERYTHING (นามสกุล, ชื่อเล่น, สาขา, สาย) kept on the person's own help request as a STATEMENT, `submit_my_house_details`; the admin adds them with one prefilled press; a trigger on `students` closes the request from ANY path — owner 2026-10-31; ✅ on samo-dev AND PRODUCTION 2026-10-31, house0268-details 30/30 + house0191 28/28 on both, red under two mutations; `tools/browser/house-details.mjs` 14/14 on dev; 0267 = a Passport activity has an EVENT DATE: its points go to that date's quarter and its QR scans from that date to `scan_until` (two months unless hand-set, ≤ 1 year), a closed quarter no longer stopping it — the ฝ่าย's 2026-10-23 agreement; ✅ on PRODUCTION 2026-10-31 (backfill: 46 activities, 15 scanning, 0 closed-quarter QR revived, latest end 18 ธ.ค. — as previewed; passport0267 36/36, 0180 6/6, 0245 47/47, 0246 16/16 on PRODUCTION; red under three mutations; `tools/browser/passport-quarters.mjs` 20/20 on dev) — telling the ฝ่าย is OWED: HANDOFF §2; 0266 = start_samo_year(): pressing เริ่มปี SAMO on Q1 day after the automatic switch already started that year now finishes (team gate kept, Passport วาระ still opened) instead of rolling the switch back — supersedes the 0249 draft; 0249 + 0266 on dev AND production 2026-10-30, year0248-one-year-system 23/23 both (red on 40/41 with the 0249 draft, red on 40/42 with the gate removed); 0265 = rotation_contact_email(): one classmate's kkumail, same gender only, for the off-criteria ask sheet — additive; on dev AND production 2026-10-30, rotation0265-contact-email 11/11 both; 0264 = truncate rotation_gpa_audit to reset test GPA edit counts back to 0 before launch; on dev AND production 2026-10-26; 0263 = rotation_board() restores state gatekeeper ('ok', 'signed_out', 'not_in_roster', 'not_published', 'no_round'), round.groups, and gpa_viewer, removing non-existent v_round.academic_year; on dev AND production 2026-10-26; 0262 = แลก Rotation off-criteria swaps (0.2–0.3, missing GPA, >0.3) with offline agreement + anti-probing GPA edit lock (max 3 edits, ROTATION_GPA_LOCKED); on dev AND production 2026-10-26, rotation0262-off-criteria 10/10 both; 0261 = silent audit trail for GPA changes (rotation_gpa_audit table + trg_rotation_log_gpa_change trigger on rotation_students + rotation_admin_gpa_audit RPC); on dev AND production 2026-10-26, rotation0261-audit 10/10 both; 0260 = rotation_board() carries has_gpa boolean on each student; on dev AND production 2026-10-24, rotation0250-swaps 99/99 both; 0259 = rotation_chain_kick RPC allows chain starter to kick/reject a taker who joined an open leg without cancelling the whole chain; on dev AND production 2026-10-24, rotation0250-swaps 99/99 both; 0258 = rotation_board() fast set-based query, ~6 ms vs ~2 s, avoids 15 s timeout on high concurrency; 0257 = purge unauthorized/misclick admin moves + restore the one student left moved; 0256 = rotation admin restricted to named accounts only — `rotation_admins` table, same pattern as 0254's `rotation_gpa_viewers`; `rotation_is_admin()` no longer trusts the `rotation` permission key (master answered yes to it, letting any team_edit holder escalate); owner seeded; both on dev AND production 2026-10-24. 0255 = แลก Rotation wishes + แลกต่อเนื่อง (3-person, all-or-nothing chains) + the `rotation_admin_move` fix (broken since 0250); on dev AND production 2026-10-24, `rotation0250-swaps` 93/93 both, red at 128 with the last-yes re-check removed — HANDOFF §32g. 0251–0254 = แลก Rotation follow-ups, on dev AND production 2026-10-24: 0251 a GPA is seen by its OWNER only (admins/master get a count) + nickname from `people` + a free-text contact; 0252 "ฉันอยากอยู่กลุ่มนี้" (`staying`); 0253 the faculty's GPA rule `band_or_close` — same band OR ≤ 0.20 apart, SWITCHED ON for y6-2570; 0254 `rotation_gpa_viewers`, a hand-kept list of ACCOUNTS (owner only) that read every GPA — `rotation0250-swaps` 70/70 both, each of §G/§H/§I red under its mutation; HANDOFF §32. 0250 = แลก Rotation ปี 6 — roster, swap asks, the locked accept; 161-student roster imported to production — `docs/ROTATION-SWAP.md`; 0249 = the draft 0266 replaced (applied before it so the history is complete); 0248 = ONE year system: 1 มี.ค. (Q1) starts the ปี SAMO for every system AND the Passport วาระสโม in one act, SAMO'69 bridged to 2569 — HANDOFF §31; on dev AND production 2026-10-23. 0247 = Passport's ฝ่าย list is admin-managed and picked from ทีม SAMO, รพ. ร่วมผลิต added as #11 with ฝ่ายย่อย #5–#7; 0246 = moving an activity's quarter moves its points; both on dev AND production 2026-10-23 — HANDOFF §30. 0245 = Passport quarters change themselves + an activity names the quarter its km go to + only org-wide admins move a quarter + the backward Q3 repair (350 scans → Q3, per-person km fingerprint identical); 0244 = ปีการศึกษา has one resolver and changes itself at an admin-set cutoff; both on dev AND production 2026-10-23 — HANDOFF §29. 0234–0241 are RESERVED for the night agent's queue — 0234 exists on samo-dev only, on its unmerged branch; 0243 = `advisor_phones`, an อาจารย์'s phone in a table of its own, house admins only, no student/anon path (`house0243-advisor-phones` 20/20 prod + dev, red with a widened policy and with the number planted in a student-visible field); on PRODUCTION 2026-10-21, then the 125 อาจารย์ + 113 phones imported by `tools/house-advisor-import.mjs` (prod only — never samo-dev, which contributors can read); 0242 = `start_samo_year()`: the ปี admin page's one-act start of a ปี SAMO + the next Passport วาระสโม, org-wide Passport grant for that half (`year0242-start-samo-year` 23/23 prod + dev, red with the Passport gate removed); on PRODUCTION 2026-10-20. 0229 is an intentional GAP — task 8 of the 2026-10-18 night-agent queue needed none, ระบบบ้าน graduation is DERIVED not stored; 0230 = `shop_orders.samo_year_be`, stamped at insert, one-time backfill from `placed_at`, `shop_order_totals()` rescoped to the current year — task 9; on PRODUCTION 2026-10-20 (`shop0230` 32/32 prod + dev). 0227 = `start_team_term`'s stored comment gives the publish → edit → switch order; 0228 = a year that is current, was in office, or has rows filed under it cannot be deleted (`team0228` 7/7 dev + prod); 0226 = anon could still call `samo_year_for_timestamp` — Supabase's default ACL grant, `year0219` now asserts the privilege; 0225 = `publish_team_term` survives PostgREST's safeupdate; both on dev AND production 2026-10-14; 0219–0224 = the SAMO-year work (night agent, reviewed + fixed), applied to PRODUCTION 2026-10-14 in order 0219, 0220, 0222, 0221, 0223, 0224 — six proofs 143/143 on production; HANDOFF §22). 0231 = two retention rollups so `prune_analytics`/`prune_claude_usage_samples` can delete raw `analytics_events`/`claude_usage_samples` rows without blinding `analytics_overview()` (`stats0231-retention` 31/31 prod + dev); scheduling is a VM systemd timer (`server/stats-retention.*`) — ⛔ DO NOT INSTALL AS WRITTEN (HANDOFF §22); pg_cron is not enabled. 0232 = `passport.samo_years.team_term_year` bridge (no FK), `dept_content_editor_info()` for the หน้าฝ่าย editor's "แก้ไขล่าสุดโดย", and `account_dashboard()`'s optional year filter (`passport0232-bridge-dept-editor-accounts` 22/22 prod + dev) — task 10; on PRODUCTION 2026-10-20. 0233 = `prune_analytics()`'s cutoff is now day-aligned — the un-aligned version (0231) silently split a calendar day across two weekly runs and the second run's `on conflict do update` overwrote (not added to) the first's partial count, permanently losing it; found by revision-pass review, reproduced live, fixed (`stats0233-no-split-day` 7/7 prod + dev) — must come AFTER 0231 (before, 0231 reinstalls the bug); on PRODUCTION 2026-10-20. 81 of 90 LIVE PROOFS GREEN on production (security0235 merged from the night agent, proj0269 + team0270 written 2026-10-31, none run on production yet; passport0267 added 2026-10-31, green; house0268 added 2026-10-31, 30/30 on production) (the 2026-10-23 full run, 74/81, + rotation0250 93/93 on 2026-10-24 after 0251–0255 + rotation0261 10/10 + rotation0262 10/10 on 2026-10-26+ rotation0265 11/11 + year0248 23/23 on 2026-10-30) (full `npm run proofs` after 0244–0248 — the 7 red are the same 7 as the 2026-10-22 run, listed next; the 6 new proofs are green). Red: dept0177 + team0135 (known), proj0181 (setup hits users_self_update_guard), proj0165 + proj0176 (need a live prof-only seat holder; production has none now), stats0231 + stats0233 (assume a day ~89 days back is empty; real events fill it now) — none from the 2026-10-21/22 work; HANDOFF §27 — red: dept0177 + team0135 (§16b; both rewritten by the night agent's task 14 on `agent/2026-10-20`, NOT merged) and proj0176 B2, a no-op write since the newest หนังสือ was completed — fixed after the run (22/22 prod + dev, red with the guard disabled). 0217 ระบบบ้าน follow-up answers (`house0217` 18/18) + restores 0190; 0218 a caller with no users row is refused everywhere (`authz0218` 30/30); 0212 + 0215 + 0216 (`proj0212` 22/22; 0216: one add/remove per click under a row lock, so two people tagging at once both land — `tools/proj0216-race.mjs` on samo-dev: old way lost a tag, new way kept both — 0215 made the tags the 12 ฝ่าย of หน้าฝ่าย, not VitalSound desks; owner: "it shouldn't have SE"), 0213 (`dept0213` 9/9) and 0214 (`passport0214` 12/12) green on dev AND production 2026-10-13 — the night agent wrote them blind and three of its proofs were broken until their first run.** 0212 ฝ่ายสโม tags on a โครงการ (sender desk only, through `set_project_samo_depts`). 0213 is a column comment: หน้าฝ่าย grants come from ทีม SAMO, never a migration (`depts.test.js` sweeps every file). 0214 ports the passport RLS lockdown into tracked history — it was already live, so applying it changed nothing. 0211 บัญชีผู้ใช้: `account_dashboard()` + `_pulse()`, master only, every account with how it signs in, its email and its other systems; also fixed `users.method` (Google sign-ups were stored as 'password') (`accounts0211-dashboard` 15/15 prod; dev 13/15 because samo-dev has no auth.users triggers, HANDOFF §19). 0202 shop sweep: stock shown = stock sold, colour/slip/qty checked, a buyer's own-order edits limited to what the slip flows write (`shop0202-stock-rule` 22/22). 0203 product gallery — several pictures, cover derived by trigger; 0204 a pre-gallery tab cannot drop or duplicate a picture (`shop0203-gallery` 19/19); 0205 no limit on a product's pictures (owner asked). 0206 `shop_order_totals()` — service_role only, the shop Discord message's overview (`shop0206-totals` 10/10, dev + prod). 0207 Discord nicknames follow ทีม SAMO — `discord_nickname_inputs()` service-only + a `people` trigger that queues a linked person (`discord0207-nicknames` 9/9, dev + prod). 0208 บอท Discord panel — `discord_bot_settings`/`_status`, definer RPCs only, permission `discord_bot` (`discord0208-panel` 14/14, dev + prod). 0209 a preorder's stock grid is a LIMIT (every preorder item counts until its order is cancelled; empty grid = unlimited) and the rule has ONE home, `shop_reserved_matrix` — the guard and `_all` ask it (`shop0209-preorder-limit` 11/11, dev + prod; 0202/0199 proofs still green). 0210 preorder and in-stock have SEPARATE tables (`preorder_stock_matrix` / `stock_matrix`); the Preorder tick picks one via `shop_active_stock()` (JS twin `activeStock`); polo-caffeine's 100 moved to its preorder table (`shop0210-two-tables` 9/9, dev + prod). 0199 shop per-size pricing (`shop0199-pricing` 20/20); 0200 the three copies of a person stay in sync + admin mismatch panel (`house0200-three-copies` 13/13, `house0194` back to 20/20), both dev AND production — what each one changed and which hole it closed is `docs/state-archive/2026-09-19-state-prune.md`; the proofs themselves are the authority. ⛔ Ask `npm run migrate:status`, never this line.
  ⚠️ A proof can be GREEN WHILE BROKEN because the environment happened to be
  quiet — both Claude quota proofs were, until they CONSTRUCTED the absence
  they assume (`docs/mistakes/tooling-proofs.md`; counts live in the proofs).

---

### WHAT PROD IS DOING RIGHT NOW

⛔ **ASK THE DATABASE FOR RUNTIME STATE, NEVER THIS FILE.** This block once said
Claude measurement was OFF and gave a procedure to re-enable what was already
enabled. `select monitoring_enabled, … from public.claude_settings`
(`db-query.mjs` takes a FILE). Same for `claude_bookings`, which is not empty,
and `monitoring_note`, which holds an old pause reason on purpose — leave it.

---

### CONTRIBUTOR CREDENTIALS — rebuilt 2026-09-06

`npm run dev` now uses **samo-dev, not production**, and says so on every start.
`.env.local.example` is the contract; adding a variable is ONE edit there.
⚠️ **samo-dev: ASK `npm run migrate:status -- --dev`, NEVER this file.** It had
drifted four migrations while a line here said it was in step. `deploy:owed`
asks PRODUCTION before it answers. Archive: `docs/state-archive/2026-09-19-state-prune.md`.

### What is owed

⏳ **2026-10-13 afternoon, all deployed:** หนังสือโครงการ ฝ่าย tags = the 12 ฝ่าย (0215) with one add/remove per click under a row lock (0216); 33 of 44 โครงการ tagged from their descriptions, 11 left for a human (HANDOFF §20); the ฝ่าย filter lists ยังไม่ระบุฝ่าย; phone/iPad layout of หนังสือโครงการ improved (see it: `tools/browser/projects-ui.mjs`). **Dark mode is BUILT but DORMANT** — light for everyone by the owner's call; what it owes before switching on: HANDOFF §21.
✅ **NIGHT AGENT RUN 2026-10-13 — reviewed, merged, 0212–0214 applied dev + prod (proofs green both).** Task 2 had been cut off by the quota and credited as done by the runner — fixed in the runner (`docs/mistakes/tooling-proofs.md`). 0213 grants NOTHING: who edits each หน้าฝ่าย is set in ทีม SAMO → สิทธิ์ → หน้าฝ่าย (owner); production had NO node carrying one, so all 12 ฝ่าย wait for an admin to choose. 0214 was already live on production (no-op; the pass-anon-probe alarm is closed). nginx headers ship with the deploy. Remaining: `docs/state/HANDOFF.md` §20.
✅ **ระบบบ้าน ROSTER IMPORTED (2026-09-14)** via `tools/house-import.mjs` (dry-run first; loop in `skills/import-the-house-roster.md`). ⚠️ **`advisors` is EMPTY** — its two rows were TEST data pointing at REAL สาย, so 12 students briefly saw a fake อาจารย์; no release note may promise อาจารย์ until real ones exist. Counts move: ask the database, not this line.
✅ **ทีม SAMO ↔ ระบบบ้าน IN SYNC** (2026-09-14) — 0 diffs on every column, 0 duplicate people, 0 mis-pointed placements; 9 humans held TWO registry rows (merged), `people` 1705 → 1696. Re-check/repair after any import: `node tools/house-sync-registry.mjs`. ⛔ **25 ทีม SAMO members have NO kkumail anywhere** — all hold real ตำแหน่ง, none matchable to a student; only a human can fill those.
✅ **ข้อมูลไม่ครบ tab** (/admin/ ระบบบ้าน) — everything missing/mismatched/odd, grouped by who can fix it; badge counts ONLY admin work. One definition, shared with `npm run house:gaps`: `src/js/house/gaps.js`. **+ ผังตามสาย view, built 2026-09-16** (list/grid toggle in the same tab) — per-รุ่น สาย grid, spec `docs/HOUSE-YEAR-HANDOVER.md` §(d), `src/js/house/sai-grid.js` reuses `gaps.js`/`census.js`. Tests+build green; ⚠️ unseen in a real browser (no DB creds tonight).
⛔ **สาย 141/256 NOT SETTLED** — สาย is a contiguous 1..N counter in four of six
รุ่น; MD53+MD54 both skip 141 and repeat 256, 115 positions each, รหัส running
straight through the gap — the new tab states it as arithmetic: สาย 141 is missing from THREE รุ่น while one held row can account for one. If it is a drag-fill slip **230 students' บ้าน is wrong**. ฝ่ายข้อมูล have not answered. Fix = ONE corrected re-import: no student
can self-edit a สาย (`sai_self_edit_open` VESTIGIAL since 0125) and บ้าน is
generated from it. ⚠️ Houses 1–9 have no `name` — the UI shows `บ้าน N` to 1,611 people.

✅ **HOME + ข้อมูลของฉัน (2026-10-16, live):** banner carousel + tool icons under it; ข้อมูลของฉัน is its own page `/me` (home keeps one account row with the needs-you flag); open items (owner confirmations, real-phone look): `HANDOFF.md` §23. ✅ **SAMO SHOP ADMIN (2026-10-15, live):** ยอดขาย tab (per product / size / colour, pieces or baht), ต้องจัดการ row, slip queue rebuilt, order ประวัติ — no schema; unseen on a real slip + real data: `HANDOFF.md` §18g. ✅ **SAMO SHOP (2026-09-21, all live):** kita's redesign (look DECIDED by the shop team) · identity = "samo shop" wordmark INSIDE the pane, never the navbar · per-size prices, and the DATABASE now sets every price (0199 — `place_shop_order` had trusted the browser) · Discord message per web order, built from the DB (`DISCORD_SHOP_WEBHOOK`, VM only) · pickup-card picture (0201) · core chunk renamed `core-*` (an `analytics-*` name let a tracking blocker kill the portal). **Registry (0200): main card / ทีม SAMO / ระบบบ้าน auto-sync on connect; mismatches listed + fixable in ระบบบ้าน → ข้อมูลไม่ครบ.** Why + how each was checked: `docs/state/claude-2026-09-21.md`. Open items (webhook rotation, Stay hypothesis, never-seen Discord message): `HANDOFF.md` §18. **2026-09-22 full shop bug sweep** (≈40 findings, all fixed but the ones in §18b): checkout double-order lock + unsure-network check + cart checked BEFORE the QR, safeUrl safe bare, admin stale-state fixes, CSV safe; write-ups in `docs/mistakes/` (frontend-ui, app-state, authz-rls, postgres-schema, tooling-proofs).

⛔ **START HERE: `docs/state/HANDOFF.md` is the full list of what is NOT done, with reasons and owners. Read it first; below is detail.**

### A. NEXT SESSION — buildable now, nobody is blocking you

✅ Shipped, do not rebuild: the passport guard (proof #27) · the docs site (02) ·
the ORG MOVE (2026-08-31, traps in `skills/move-the-repo-to-an-organisation.md`,
`HANDOFF` §3). ⛔ **No polling timer for the docs** — built and REMOVED same day.

1. ✅ **A ฝ่าย EDITS ITS OWN PAGE — no commit, no deploy (0177/0178/0179).**
   เมนู "หน้าฝ่าย" in /admin/; four kinds (หัวข้อ · การ์ด · ข้อความ · HTML), a new
   row is a DRAFT, upload included. ✅ **AND the ฝ่าย tools lane** —
   `public/embed/starter/` → `tool/*` PR → `/tools/<slug>`. Both LIVE.
   ⛔ **THE ISOLATION OF BOTH IS ONE MISSING WORD** (`allow-same-origin`), and
   the three changes that delete it are now a rule in `docs/INVARIANTS.md` —
   with the owner-facing fake-sign-in risk. Read it before touching the frame.
   ✅ **THE VISUAL EDITOR IS ACCEPTED AND BUILT OUT** (owner 2026-09-11, "do
   it") — 21 blocks in 5 Thai categories, the link field now findable, links
   pinned to `_blank`, placeholders inlined. ⏸ **PAUSED by the owner the same
   day; do not extend it unasked.** Still no end-to-end drag-and-save by a
   human. HANDOFF §4 — read its viewport near-miss before any layout work.
   ⚠️ An earlier note the SAME DAY said a canvas was REJECTED — superseded, and
   `docs/state/phuriphatma.md` says so at both ends. Why GrapesJS and not
   Puck/Craft.js (React-only), plus the block-set work next: same file.
   ❌ **What is left is NOT code: §13 step 8, teach two people**, and step 5 on
   a REAL phone. Detail: `docs/state/phuriphatma.md` + `docs/DEPT-TOOLS.md`.
2. ⚠️ **THE DEPLOY DOCS STEP — INTERMITTENT.** An intermittent fault is never
   disproven by successes; this entry once claimed the opposite. Read the VM's
   `~/samo-deploy-logs` trace before theorising. Status: CURRENT DEPLOY, above.
3. ✅ **PASSPORT REPO MERGE — COMPLETE**, old repo ARCHIVED. ⛔ Never delete the `samomdkkupassport` Cloudflare project — `docs/INVARIANTS.md`.
4. ✅ **DISCORD ROLE SYNC — LIVE AND AUTOMATIC (2026-09-19).** Discord follows
   ทีม SAMO by itself: the `samo-discord-sync` service (VM) applies a web change
   in ~5–10 s, re-checks everything every 15 min (reverting hand edits in
   Discord), and posts who changed what to `🤖┆samo-role-assignment-bot`.
   ⛔ **Change the WEB, not Discord.** How it works, the owner's rules, what is
   owed and the traps: **`HANDOFF` §14b** (the day's history is archived in
   `docs/state-archive/2026-09-19-discord-sync.md`). Owner still owes: kick the
   old bot, narrow the new bot's Administrator (HANDOFF §1).

### B. OWNER ONLY

⛔ **One home: `docs/state/HANDOFF.md` §1 and §3.** This section used to restate
those four items and drifted from them; do not re-add a copy here.

- ✅ **Nothing owed on Claude measurement, the `claude` grant, or ประกาศ.** Ask
  the DATABASE for runtime state; this file must not carry it.
- ⏸ **The boot bar's first-failure branch — OFFERED, owner decides.**
- ✅ **DEV SYSTEM — phases 1, 3, 4, 5 and 6 are DONE.** Only phase 2's last
  item remains and it is OWNER-GATED (§B1). Plan + per-phase status:
  `docs/TEAM-WORKFLOW.md` §8; procedure and every trap
  `skills/build-the-dev-database.md`. **`samo-dev`'s ref is in
  `SUPABASE_DEV_URL`** (separate account, D7); creds are the `SUPABASE_DEV_*`
  block in `.env.local`, shareable with the team, **URL never published — dev
  holds REAL student data**. Rebuild `CONFIRM=1 npm run dev:refresh`; check
  `npm run dev:check`; proofs `npm run proofs:dev`. **Google sign-in is OFF on dev.**
- **The docs site is `docs/` RENDERED.** Nothing secret goes in `docs/`.
- **ฝ่าย tools — WORKFLOW, REGISTRY AND FRAME ARE ALL LIVE.** Read
  `docs/DEPT-TOOLS.md` (§0a = owner decisions, do not re-litigate). Also live:
  branch protection, `CODEOWNERS`, the Thai request template,
  `skills/onboard-a-contributor.md`, and **Golden Period at
  `/tools/golden-period`, THEIRS to PR against**.
  ⛔ Lane C (a tool that reads real data) is still HARD-BLOCKED on §13 step 15.
- **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK.** Read
  `docs/demos/about-3d/README.md`, not a bullet.
- **The browser pass, continued — `skills/drive-the-browser.md`.** Still
  undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
  CHECKOUT. `docs/NEXT.md` §1. The auth blocker is solved; §4b of that skill has
  the recipe and both traps.
- **ทีม SAMO restructure — read `docs/INVARIANTS.md` before reparenting a ฝ่าย.**
- `docs/NEXT.md` carries the rest. Genuinely un-started: §0c (two latent
  role-only policies, deliberately not swept), §0a (ทีม SAMO admin model, PARKED
  by the owner), §0b2 + §1 (the browser pass). ⚠️ Its §0
  (`photo_reference_count()` cannot see `houses.icon_url`) is **already FIXED**
  — read from `pg_get_functiondef`, 2026-09-01. 0178 added the ฝ่าย covers too.

---

⛔ **ระบบบ้าน's 13 unplaced held rows: FIXED, pruned to `docs/state-archive/
2026-09-19-state-prune.md`** (2026-09-19) — detail there and in memory
`house-unplaced-cohort-fixed.md`; `_สายมีปัญหา` is 5, not 18. Five รุ่น still
owed on MD50's promotion pattern, `HANDOFF.md` §16.

## ✅ THE HANDOFF IS A COMMAND NOW (2026-09-19)

`npm run handoff:check` — step 6 of CLAUDE.md's loop and the only one that can
FAIL. Uncommitted work · unpushed HEAD · an unindexed memory · a memory naming a
dead file or command · a HANDOFF section with no `Status:` · this file over
budget · prod behind the sha this file claims · the VM's agent memory out of
sync · **a count in a document the database contradicts**. A check it could not
RUN is a skip, and a skip is NOT green. It cannot tell whether a sentence is
true. Detail: `HANDOFF.md` §9.

⚠️ **`npm test` is NOT the test CI runs** — the suite reads gitignored files, and
that asymmetry went red in both directions. `npm run test:clean` runs it over
exactly what git will carry. Both live in `HANDOFF.md` §9.

## 🌙 NIGHT AGENT — queue 14–23 continues (2026-10-20)

Tasks 8–13 REVIEWED, MERGED to `main`, ON PRODUCTION 2026-10-20 (HANDOFF §22
"DONE 2026-10-20": 12 defects fixed in review, 4 proofs that were only right on
samo-dev). `origin/main` merged into `agent/2026-10-20`; its work is now
`origin/main..HEAD`. Queue: 14 dev fidelity · 15 security · 16 lint · 17 a11y ·
18 speed · 19 split · 20 tests · 21 Passport · 22 review · 23 HANDOFF §24.
`Until` 2026-10-21 08:30 UTC (owner: stop at the natural weekly reset),
`Reserve sessions: 0`, VM `TASK_MAX_TURNS=400`; bookings still win. 0234
(task 14, dev auth triggers) is on samo-dev only. Reserved 0234–0241.
⛔ Review its branch before production. Owed + not verified: HANDOFF §17/§22.

## ✅ VAULTWARDEN — LIVE at `/vault/` (2026-09-06)

Ops `skills/vaultwarden.md` · architecture `docs/CONTEXT.md` · what it owes HANDOFF §7 (incl. restore, NEVER run). ⛔ **`SIGNUPS_DOMAINS_WHITELIST` must stay UNSET** — a non-empty value overrides `SIGNUPS_ALLOWED=false` and opened registration to every KKU kkumail for ~6 h (`docs/mistakes/authz-grants.md`).

## NEXT SESSION — start here

1. **This file**, top to bottom. Read all of it.
2. **`docs/state/HANDOFF.md`** — the ONLY list of what is not done, each
   section carrying a `Status:` saying how far to trust it.
3. **`docs/INVARIANTS.md`** — the rules. Longer, and it changes slowly.
4. **The newest `docs/state/claude-*.md` and `docs/state/phuriphatma.md` — each one's FIRST `## ▶ HANDOFF` block**, whichever
   date that is. It names what is owed, what is waiting on the owner, and what
   was deliberately NOT verified. Everything below it is history, including
   older handoff blocks.
   ⚠️ **Never name a date here** — one was, and a newer block landed above it.
5. Only then, the archive file for whatever you are about to touch.

**What waits on the owner is section B above — do not restate it here.** These
are DECISIONS rather than credentials, and none should be built unprompted. Ask
in plain language:

| # | Question | Where | Recommendation on file |
|---|---|---|---|
| 1 | **Turn on password reset?** It does not exist today and mail config is why — the biggest user-visible win available | `docs/EMAIL.md` §2/§5 | start with a Gmail app password; needs nothing from KKU |
| 2 | Should the Claude usage reporter poll more often than every 15 min? | `docs/NEXT.md` | **leave it at 15** |
| 3 | Build the boot bar's first-failure branch? | ⏸ above | offered, not urgent |
| 4 | เกี่ยวกับเรา on mobile — which of the demos? | above | read `docs/demos/about-3d/README.md`, do not summarise it |
| 4b | **Merge `samomdkkupassport`?** ✅ **DONE 2026-09-04** — subtree'd, tested, deployed, old repo archived. Full record + the two traps that remain: `docs/PASSPORT-MONOREPO.md`. ⛔ Do NOT reconnect the passport Pages project and ⛔ never delete it (QR posters) | done | — |
| 5 | **SUCCESSION.** The two role gmails (studbeta, samomdkku.ai) handed down each year are the RIGHT shape — ⛔ decided, do not re-litigate. But **studbeta alone holds prod Supabase + the Google sign-in OAuth client + Cloudflare**, its Cloudflare member is Super Administrator with **2FA OFF**, and the VM ssh key is on one Mac | `docs/SUCCESSION.md`, `npm run succession:audit` | **step 0 is the recovery settings on both gmails** — "it does not graduate" is a property of those, not of the address. Then cross-add each account to the other's systems. The GitHub move is step 7 of 8 |
| 6 | ~~Move to a GitHub organisation?~~ ✅ **DONE 2026-08-31 except Cloudflare.** Both repos are in the org, `CODEOWNERS` names a team, Copilot is unaffected (org holds 0 seats — never buy any). ⛔ Do not re-litigate | `skills/move-the-repo-to-an-organisation.md` §0a | **One thing left needs the dashboard: reconnect Cloudflare Pages (§5a), or previews stay dead** |
| 7 | ~~What URL should the docs site have?~~ ✅ **ANSWERED AND BUILT 2026-08-31 — nothing owed.** `https://samo.md.kku.ac.th/docs` serves the real pages from the VM. (HOW they get rebuilt is status, not a decision — the CURRENT DEPLOY block above is its one home; do not restate it here.) ⛔ **Do not re-open this and do not ask KKU for a subdomain** — the owner confirmed KKU gives one VM and one hostname, so `docs.samo.md.kku.ac.th` was never available and the CNAME plan that stood here was dead on arrival | `server/nginx-samo.conf`, `server/deploy.sh` | Serving docs at a PATH is mainstream, not a compromise: nextjs.org/docs, tailwindcss.com/docs, supabase.com/docs and kubernetes.io/docs all answer 200 at the path (measured). ⛔ **And do not re-add a polling timer.** One was built and removed the same day: its whole justification was "otherwise publishing needs someone on VPN", and the owner's answer was that deploy-time updates are fine. Pull-based deploy is a real pattern (ArgoCD, Flux) but it is for keeping an app current, not a docs page — **the lesson is that the requirement was assumed, not asked** |

⛔ **Previews are NOT on this list — they were DECIDED long ago** (§1 + D8:
per-PR, Cloudflare Pages). A session re-opened them on 2026-08-27 and wasted a
round trip. **Check `docs/TEAM-WORKFLOW.md` §0/§1 before asking anything.**

⛔ **Do not offer to "build the ฝ่าย tools frame" — it is BUILT** (2026-09-01),
and so is the หน้าฝ่าย editor beside it. What is left there is §13 step 8:
teaching two people. See A1.
📌 Golden Period itself is THEIRS — IT only drafted it; hand the route over when
their version lands. An IT-built page is a page IT owns, which is the bottleneck
that design removes.

**No deploy is owed.** Check, do not trust this line — and note that it names no sha, on purpose.
2026-08-28, and `state-handoff.test.js` now forbids the shape:
```bash
npm run deploy:owed
```
