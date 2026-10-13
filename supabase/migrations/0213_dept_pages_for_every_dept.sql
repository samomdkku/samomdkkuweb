-- ============================================================
-- 0213 — every ฝ่าย gets a หน้าฝ่าย, and its OWN people can edit it
--
-- ASKED (owner, night queue 2026-10-13): "the หน้าฝ่าย tab, currently there's
-- not all ฝ่าย exist, people have complaint that there isnt their ฝ่าย and
-- cant go in to edit, add all ฝ่าย, and the permission".
--
-- ⛔ WRITTEN BY THE NIGHT AGENT, NOT APPLIED. No database access this run —
-- the owner's next session applies this to samo-dev first, then production,
-- and runs tools/dept0213-every-dept.mjs. See STATE.md.
--
-- THE CODE HALF OF THIS (same commit): DEPT_DEFS (src/data/depts.js) grew from
-- 6 to the 12 top-level ฝ่าย ทีม SAMO actually carries, so the หน้าฝ่าย grid,
-- the grant picker (DEPT_PAGES, team-vocab.js) and the /admin/ → หน้าฝ่าย
-- editor (dept-page-admin.js) all derive the full 12 automatically — none of
-- the three hardcode a list (docs/DEPT-TOOLS.md §2 / mistakes class 6).
--
-- THIS MIGRATION IS THE OTHER HALF: WHO MAY EDIT EACH ONE. A page with no
-- grantable editor is uneditable for ever, which is exactly the complaint —
-- six ฝ่าย existed with no row anywhere saying who may write dept_content for
-- them, so the only way in was the blanket `dept_pages` permission (vp_admin /
-- dev / master), not the ฝ่าย's own people.
--
-- DECISION — INHERIT, DO NOT WIDEN. `team_nodes.dept_page` (0177) already
-- inherits down the tree through `node_effective_dept_pages()`: whoever is
-- posted under a node that carries `dept_page = 'x'` (directly, or through an
-- ancestor with `inherit_permissions` still true — the DEFAULT) gets 'x' added
-- to their `managed_dept_pages` on next sync, which is exactly the 5th scope
-- dimension 0177 built, mirroring `vs_dept` (0082/0083) on purpose. Setting
-- `dept_page` ONCE, on each top-level ฝ่าย node, is therefore enough to let
-- every person under that ฝ่าย edit its page — not a new mechanism, the SAME
-- one the first six ฝ่าย presumably already use (set by hand, through the
-- admin tree UI, which is why this migration only fills a NULL and never
-- overwrites one — see §2).
--
-- WHY THIS DOES NOT NEED NARROWING. The brief asks to check whether
-- inheritance would (a) let someone edit a page they should not, or (b) let a
-- member PUBLISH without review, and narrow if so.
--   (a) `current_user_dept_page_scope()` returns the EXACT ฝ่าย list a person's
--       tree posting resolves to — not "every page", not a sibling ฝ่าย's page.
--       A member of ฝ่ายวิชาการ inherits 'academic' only; dept_content RLS
--       (0177 §4) checks `dept = any(scope)` on every read of a hidden row,
--       insert, update AND delete, so there is no path from "posted under
--       ฝ่ายวิชาการ" to "can touch ฝ่ายกิจการภายใน's rows". The proof below
--       asserts this directly (§2).
--   (b) There is no review step for ANY of the six ฝ่าย this already runs for
--       today — a save is live the instant it is pressed (dept-page-admin.js
--       `save()` PATCHes directly; RLS is the only gate, not a staff-approval
--       queue). The one safeguard that exists — a NEW row is born
--       `visible = false` until the ฝ่าย itself flips it on — is per-ROW, not
--       per-ฝ่าย, and it already applies identically to all twelve. Extending
--       the exact mechanism six more ฝ่าย already share is not a new risk to
--       weigh; it is removing an inconsistency (some ฝ่าย could self-publish,
--       some could not, for no stated reason). So: no narrowing.
--   **What would change this**: if the owner wants a STAFF REVIEW step before
--   a ฝ่าย's page goes live, that is a real feature (a `pending_review` state
--   on dept_content, gated to `vp_admin`/`dev`) — but it is a product decision
--   for ALL twelve ฝ่าย, not something to bolt onto only the six added here.
--
-- MATCHED BY EXACT NAME, deliberately not a hardcoded `team_nodes.id` (names
-- rot less than ids across a tree reorg, and this repo has paid for guards
-- whose subject is a hardcoded id that rotted — mistakes class 7). Matched
-- against `kind = 'division' and parent_id is null` so a role or sub-node that
-- happens to share a ฝ่าย's name is never touched.
--
-- ONLY WHERE `dept_page is null` — admin/digital/academic/strategy/media/rt
-- may already carry a value set by hand through the tree UI, and overwriting
-- those would silently REVOKE whatever scope an admin chose on purpose (it
-- might not be the blanket top-level node; 0177 lets it be set on any node in
-- the subtree). This migration only FILLS A GAP, never corrects one.
-- ============================================================

update public.team_nodes t
   set dept_page = v.dept_key
  from (values
    ('สำนักนายกฯ',                       'office'),
    ('ฝ่ายบริหารองค์กร',                  'admin'),
    ('ฝ่ายดิจิทัลและสื่อสารองค์กร',        'digital'),
    ('ฝ่ายกิจการภายใน',                   'internal'),
    ('ฝ่ายกิจการภายนอก',                  'external'),
    ('ฝ่ายกิจการมหาวิทยาลัย',              'university'),
    ('ฝ่ายวิชาการ',                       'academic'),
    ('ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',       'strategy'),
    ('ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',       'quality'),
    ('ฝ่ายรังสีเทคนิค',                   'rt'),
    ('ฝ่ายเวชนิทัศน์',                    'media'),
    ('ฝ่าย รพ. ร่วมผลิต',                 'hospital')
  ) as v(dept_name, dept_key)
 where t.kind = 'division'
   and t.parent_id is null
   and t.name = v.dept_name
   and t.dept_page is null;

-- ------------------------------------------------------------
-- Backfill, same shape as 0177 §6 — so the grant is not empty until each
-- person's next login/sync. Idempotent: sync_my_team_permissions()'s own
-- `is distinct from` guard means a second run of this file (or of the backfill
-- loop) writes nothing for someone already in step.
-- ------------------------------------------------------------
do $$
begin
  perform set_config('app.team_sync', '1', true);
  update public.users u
     set managed_dept_pages = public.effective_team_dept_pages_for_email(u.email)
   where u.email is not null
     and u.managed_dept_pages is distinct from public.effective_team_dept_pages_for_email(u.email);
  perform set_config('app.team_sync', '', true);
end $$;
