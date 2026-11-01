-- ============================================================
-- 0273 — the ถาวร list joins live sync
--
-- REPORTED 2026-11-01: "why is there SAMOWEB FOUNDER MD50 in the เกี่ยวกับเรา".
-- A tab that loaded before a group was marked ถาวร (0272) got the new NODE
-- through live sync (team_nodes is in supabase_realtime since 0048) but never
-- the MARK, so it drew the ถาวร group under ประจำปี. Working in that view —
-- adding a top-level ฝ่าย beside it, dragging — treated it as yearly: the API
-- log shows a ฝ่าย created with no ถาวร mark and both nodes re-positioned in
-- one drag, the one shape only that view can produce.
--
-- Additive: the table joins the publication. node_id is its primary key, so a
-- DELETE event carries it with the default replica identity.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'team_standing_groups'
  ) then
    alter publication supabase_realtime add table public.team_standing_groups;
  end if;
end $$;
