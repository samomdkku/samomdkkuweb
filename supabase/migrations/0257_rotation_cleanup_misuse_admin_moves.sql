-- ============================================================
-- 0257 — แลก Rotation: purge unauthorized/misclick admin moves
--
-- REQUESTED (owner, 2026-10-24):
-- "also make the guy like ณัฐพงษ์ (ปัน) เพิ่งย้าย ย้ายมาจาก B · ผู้ดูแลย้าย
-- not showing this because it's misuse misclick"
--
-- Incident context:
-- Before 0256 restricted rotation admin to named accounts, multiple users
-- holding `master` via ทีม SAMO inherited rotation admin rights and
-- tested/misclicked the admin move dropdown on students:
--   - พศิน (C -> A -> C)
--   - ณัฐพงษ์ (A -> B -> A)
--   - นวปรัชญ์ (A -> F -> E -> A -> E)
--   - ภูสุดา (B -> C -> B)
--
-- This left misleading `rotation_moves` records with kind='admin' that
-- showed "เพิ่งย้าย ย้ายมาจาก ... · ผู้ดูแลย้าย" on their cards and cluttered
-- the activity feed. นวปรัชญ์ was also left in group E instead of her original A.
--
-- §1. Delete all kind='admin' moves created during this incident.
-- §2. Reset นวปรัชญ์ back to her original group ('A').
-- §3. Emit a Realtime event on rotation_events so all connected clients reload.
-- ============================================================

-- §1 — remove the bogus admin moves from rotation_moves.
delete from public.rotation_moves
 where kind = 'admin';

-- §2 — restore นวปรัชญ์ back to original group ('A').
update public.rotation_students
   set current_group = original_group,
       updated_at = now()
 where id = '313e9169-3778-4d6b-993b-367b73718ece'
   and current_group is distinct from original_group;

-- §3 — notify connected browsers via Realtime channel.
insert into public.rotation_events (round_id)
values ('y6-2570');
