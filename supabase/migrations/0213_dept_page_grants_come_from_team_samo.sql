-- ============================================================
-- 0213 — every ฝ่าย has a หน้าฝ่าย; WHO may edit it is set in ทีม SAMO, by a
--        person, never by a migration.
--
-- ASKED (owner, night queue 2026-10-13): "the หน้าฝ่าย tab, currently there's
-- not all ฝ่าย exist, people have complaint that there isnt their ฝ่าย and
-- cant go in to edit, add all ฝ่าย, and the permission".
--
-- THE FIX IS IN THE APP, NOT HERE. DEPT_DEFS (src/data/depts.js) grew from 6
-- to the 12 top-level ฝ่าย, and the ทีม SAMO permission picker (DEPT_PAGES,
-- team-vocab.js) is DERIVED from it — so all 12 can now be granted in ทีม SAMO
-- → สิทธิ์ → หน้าฝ่าย, on a node (inherited by everyone under it) or on one
-- person. That picker was the "permission" that was missing: before, six ฝ่าย
-- could not be chosen there at all.
--
-- ⛔ WHY THIS FILE GRANTS NOTHING. The night agent's first draft set
-- `team_nodes.dept_page` on all 12 top-level ฝ่าย nodes, on the premise that
-- "the first six ฝ่าย presumably already" had it. Measured on production
-- 2026-10-13: NO team_node carried a dept_page and ONE user held a scoped
-- grant, so that draft would have handed ~240 accounts — every member of
-- every ฝ่าย — the right to edit and publish their ฝ่าย's public page at once,
-- with no review. Owner decided (2026-10-13): "it's config from the permission
-- of teamsamo หน้าฝ่าย" — an admin chooses, in ทีม SAMO, who edits each page.
-- A grant written in a migration is invisible to the people who manage the
-- tree, and it cannot be told apart from one they chose.
--
-- What remains is a column comment, so the next reader of the schema finds
-- the rule where they are looking. tools/dept0213-team-samo-grant.mjs proves
-- the path end to end: a grant SET IN ทีม SAMO on one of the six newly added
-- ฝ่าย lets that ฝ่าย's people edit its page and not another's.
-- ============================================================

comment on column public.team_nodes.dept_page is
  'หน้าฝ่าย this node grants, inherited by everyone posted under it while '
  'inherit_permissions holds (node_effective_dept_pages, 0177). Set by an '
  'admin in ทีม SAMO → สิทธิ์ → หน้าฝ่าย — never by a migration (0213): which '
  'people edit a ฝ่าย''s public page is the tree managers'' decision.';
