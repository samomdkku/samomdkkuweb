-- ============================================================
-- 0224 — ทีม SAMO handover: close the authz gap 0219 shipped with, and make
-- the outgoing year archive ITSELF at the moment of handover (night agent,
-- task 4 of the 2026-10-14 queue — "ทีม SAMO + จัดการทีม + permissions
-- handover + Discord roles"). Design: docs/YEAR-ROLLOVER.md § ทีม SAMO.
--
-- ⛔ BUG FOUND BY RE-READING 0219 AGAINST 0110, NOT ASSUMED. start_team_term
-- gated on `current_user_has_permission('team')`. But `team` stopped meaning
-- "may edit ทีม SAMO" the day 0110 split it: `effective_team_permissions_
-- for_email()` now injects the bare 'team' key into EVERY person found in
-- `team_members` (0110's own comment: "a posting in the tree grants VIEW of
-- ทีม SAMO, with no grant needed") — 300+ people today, none of whom chose to
-- hold it, all VIEW-only. `start_team_term` is a full handover: it closes the
-- outgoing term and opens the incoming one for every `samo_year_be` trigger
-- in the codebase. Gating that on the VIEW key meant any of those 300+
-- accounts could flip the SAMO year's current term by calling the RPC
-- directly (curl/the browser console; it needs no UI). This is the class-1
-- shape the mistakes file already names ("a per-row policy is not a column
-- policy") turned sideways: a per-PERSON view grant is not an ACTION grant.
-- `publish_team_term` (0104) and the `team_nodes`/`team_members` write
-- policies (0110) all correctly gate on `team_edit` — only `start_team_term`
-- drifted, because 0219 was written against the design doc's own illustrative
-- snippet rather than against `team_edit`'s live meaning. Fixed by matching
-- the SAME predicate `publish_team_term` already uses.
--
-- ⛔ SECOND DECISION: start_team_term NOW auto-archives the OUTGOING term
-- before closing it, by calling publish_team_term(outgoing_year) inline, in
-- the SAME transaction. WHY: skills/year-rollover.md (written by task 2)
-- said "edit the live tree to the NEW team first, then hand over — or hand
-- over first and edit after, either order is fine." That is false given how
-- publish_team_term actually works: it snapshots whatever the LIVE tree
-- looks like AT CALL TIME into that year's archive, with no idea which term
-- was current when a person was actually serving. If an admin edits the tree
-- to the incoming team BEFORE calling start_team_term, then later publishes
-- the outgoing year "to be safe", publish_team_term(outgoing_year) would
-- snapshot the INCOMING team under the OUTGOING year's label — corrupting
-- the one thing an archive exists to get right. The owner's own words for
-- this task were "next year's team is prepared without touching this year's
-- ... published at the boundary" — which is only true if the boundary
-- publishes BEFORE anyone touches the tree for next year, automatically,
-- not as a manual step an admin can forget or sequence wrong.
--
-- This makes the safe order the only one that needs no separate manual
-- step: call start_team_term(new year) FIRST — it captures the outgoing
-- team exactly as it stood, with no separate publish click required — THEN
-- edit the live tree for the incoming team. Editing before handover is
-- still POSSIBLE (nothing blocks writes to team_nodes/team_members outside
-- a handover, and this migration does not add such a block — see "no new
-- last-team_edit-holder guard trigger" below for why a bigger enforcement
-- mechanism was rejected) and would still misfile the archive exactly as
-- before; this fix narrows the failure window (no forgotten/out-of-order
-- manual publish) rather than making the wrong order impossible.
-- skills/year-rollover.md is corrected below in the same spirit.
--
-- Nesting publish_team_term() inside start_team_term() needs no extra
-- privilege check: both are SECURITY DEFINER, but a definer function does
-- NOT change auth.uid() — it only changes which role owns the tables being
-- touched. publish_team_term() re-runs its OWN `vp_admin/dev or team_edit`
-- check against the SAME caller who already passed start_team_term's
-- (now-identical) check above, so it can never raise there. If a future
-- editor ever drifts the two predicates apart, that re-check is exactly what
-- would catch it — deliberately kept, not an optimisation to inline away.
--
-- WHAT WAS NOT CHANGED, AND WHY (permissions handover, the rest of the ask):
--   - Grants still flow from the LIVE TREE (`sync_my_team_permissions()`,
--     0081/0177), never from `team_terms`. A handover that touches no
--     team_nodes/team_members row revokes nobody and grants nobody — correct,
--     per docs/YEAR-ROLLOVER.md's own edge case 3, and unchanged here.
--   - No new "last team_edit holder" guard trigger. Considered and rejected:
--     `team_edit` is held three ways at once (manual users.permissions, a
--     team_members row's own `permissions`, and inherited via
--     `node_effective_permissions` walking every ancestor) and the 'master'
--     fold adds a fourth. A correct "would this leave zero holders" check
--     would have to re-run that whole resolution for every remaining person
--     on every tree write — exactly the kind of guard this repo's mistakes
--     file warns reads like safety and is actually a performance and
--     correctness risk of its own. The existing escape hatch already covers
--     the real failure mode: `dev`-role accounts (e.g. samomdkkudev) always
--     pass the `current_user_role() = any(array['vp_admin','dev'])` branch
--     of EVERY gate in this file, independent of the tree, so "nobody can run
--     the next handover" cannot actually happen while that account exists.
--     skills/year-rollover.md already names this as the documented recovery
--     path; restated here as the reason nothing new was built for it.
--   - Discord role sync (`discord_role_targets()`, 0184/0196/0197) is
--     UNCHANGED and verified-not-touched on purpose: it reads `team_members`/
--     `team_nodes`/`discord_links` only — zero references to `team_terms` —
--     so it is ALWAYS "the current term" by construction; a handover that
--     moves nobody in the tree moves no Discord role either, and a handover
--     that does move people is picked up by the existing queue/trigger
--     mechanism within minutes, same as any other tree edit. Proof §D below
--     pins this with a body-text assertion so a future edit threading
--     `team_terms` into that function cannot land silently.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. start_team_term(year) — same signature, same return shape as 0219.
--    Only the authorization predicate and the auto-archive step change.
-- ---------------------------------------------------------------------------
create or replace function public.start_team_term(p_year integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_current integer;
  v_now     timestamptz := now();
  v_closed  integer;
  v_archive jsonb := null;
begin
  -- 0224 FIX: 'team_edit', not 'team'. See this file's header — 'team' is a
  -- VIEW grant implicit to every ทีม SAMO posting since 0110; gating a
  -- handover on it let any of 300+ view-only accounts flip the current year.
  -- coalesce(..., false) stays load-bearing (0218's lesson): a caller with no
  -- public.users row must be refused, not waved through by a NULL comparison.
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'start_team_term: ไม่มีสิทธิ์';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'start_team_term: bad year %', p_year;
  end if;

  select year into v_current from public.team_terms where is_current limit 1;

  -- Edge case 5 (docs/YEAR-ROLLOVER.md): a double-run must refuse with a
  -- clear message, never silently re-open the same term.
  if v_current is not distinct from p_year then
    raise exception 'start_team_term: ปี % เป็นปีปัจจุบันอยู่แล้ว', p_year;
  end if;

  -- 0224 ADD: archive the OUTGOING term exactly as the live tree stands RIGHT
  -- NOW, before anything below (or any later edit) can touch it. Same call
  -- the "เผยแพร่ปีนี้/เผยแพร่ซ้ำ" button already makes — this just makes it
  -- automatic at the one moment it must not be skipped or mis-ordered. Only
  -- when v_current exists: a from-scratch bootstrap with no current term yet
  -- has nothing to archive.
  if v_current is not null then
    select public.publish_team_term(v_current) into v_archive;
  end if;

  -- Close the outgoing term FIRST: team_terms_one_current (0104) is a partial
  -- unique index on is_current, so a second row cannot become true while the
  -- first still is. Both statements are ONE plpgsql call, hence one
  -- transaction — no other session can ever see zero current terms between
  -- them, unlike the two separate PATCH requests this RPC replaces.
  --
  -- started_at = coalesce(started_at, '-infinity') FIXES THE GENESIS ROW the
  -- instant it first closes — unchanged from 0219; see that migration's
  -- header for the full reasoning (reproduced in a rolled-back probe there
  -- before the fix existed).
  update public.team_terms
     set is_current = false,
         ended_at    = v_now,
         updated_at  = v_now,
         started_at  = coalesce(started_at, '-infinity'::timestamptz)
   where is_current;
  get diagnostics v_closed = row_count;

  insert into public.team_terms (year, is_current, started_at, updated_at)
       values (p_year, true, v_now, v_now)
    on conflict (year) do update
       set is_current = true,
           -- Edge case 6, a rollover undone and redone: a term's ORIGINAL
           -- started_at is a fact about history and must not move once set.
           started_at = coalesce(public.team_terms.started_at, v_now),
           ended_at = null,
           updated_at = v_now;

  return jsonb_build_object(
    'year', p_year, 'previous_year', v_current,
    'started_at', v_now, 'closed_terms', v_closed,
    'archived_outgoing', (v_archive is not null)
  );
end;
$$;

-- Functions are granted EXECUTE to PUBLIC by default (0101's lesson) —
-- revoke from both public and anon by name; only a signed-in account may
-- even attempt the authorization check above. (Restated from 0219; a
-- `create or replace` does not change existing grants, but an explicit
-- revoke+grant here means this migration is correct read on its own, with
-- no silent dependency on 0219 having run first in exactly this spot.)
revoke all on function public.start_team_term(integer) from public;
revoke all on function public.start_team_term(integer) from anon;
grant execute on function public.start_team_term(integer) to authenticated;

comment on function public.start_team_term(integer) is
  'The SAMO-year handover. Requires vp_admin/dev role or the team_edit '
  'permission (0224 — NOT the bare "team" view grant 0110 hands every '
  'posting, which 0219 wrongly accepted). Auto-archives the outgoing term '
  '(calls publish_team_term on it) before closing it, so "prepare next '
  'year''s team without touching this year''s" is enforced by ORDER, not '
  'by a manual step: call this FIRST, edit the live tree for the incoming '
  'team AFTER. See docs/YEAR-ROLLOVER.md § ทีม SAMO and skills/year-rollover.md.';
