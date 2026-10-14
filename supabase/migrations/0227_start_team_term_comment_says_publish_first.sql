-- ============================================================
-- 0227 — start_team_term's stored COMMENT recommended the worse handover order.
--
-- 0224's comment says "call this FIRST, edit the live tree AFTER". Since 0153 a
-- PUBLISHED year — even the current one — is shown publicly from its archive,
-- and since 0224 (as fixed in review) the handover never re-snapshots a
-- published year. So the order that keeps the public page right throughout is
-- publish → edit → switch; switching first labels the half-edited live tree as
-- the new team until the edit is done. A comment on a live function is the
-- documentation an operator reads in the database itself (mistakes class 6:
-- prose is an implementation too) — corrected here, not by editing 0224.
-- Comment only: no behaviour changes. Runbook: skills/year-rollover.md step 2.
-- ============================================================
comment on function public.start_team_term(integer) is
  'The SAMO-year handover. Requires vp_admin/dev role or the team_edit '
  'permission (never the bare "team" view grant). Auto-archives the outgoing '
  'term (publish_team_term) before closing it ONLY if that year was never '
  'published — an existing archive is never overwritten. Recommended order '
  '(0227): publish the outgoing year, edit the live tree into the incoming '
  'team (the public page keeps showing the archive meanwhile; grants follow '
  'the live tree immediately), then call this. See skills/year-rollover.md.';
