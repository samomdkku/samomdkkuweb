-- ============================================================
-- 0253 — แลก Rotation: the faculty's GPA rule, as answered.
--
-- REQUESTED (owner, 2026-10-24, the faculty's answer to "may a 3.0 swap with
-- a 2.8?"): "for the grade, use that range, but if grades are from different
-- groups (e.g., 3.3 and 3.6), the difference shouldn't be more than 0.2".
--
-- So two students may swap when BOTH have a GPA and either
--   • they are in the same band (2.55–2.99 · 3.00–3.49 · 3.50–4.00), or
--   • their GPAs are at most 0.20 apart (2.95 ↔ 3.10 yes; 3.30 ↔ 3.60 no).
-- 0.20 exactly is allowed ("shouldn't be MORE than 0.2"). GPA is numeric(3,2),
-- so the comparison is exact, no float edge.
--
-- New value gpa_rule = 'band_or_close'; 'same_band' (stricter) stays
-- selectable. THIS ROUND ('y6-2570') IS SWITCHED TO IT HERE, because the owner
-- stated the rule. Consequence, said on the page too: a student with NO GPA
-- can neither ask nor be asked until they fill one in.
--
-- Still the ONE home: rotation_pair_allowed(). The board's can_swap, the
-- request guard and the accept guard all read it (0250/0252), so nothing else
-- changes. An ask made before the rule went on is re-checked at accept and
-- refused 'not_eligible' if the pair no longer qualifies.
--
-- Proof: tools/rotation0250-swaps.sql §H.
-- ============================================================

alter table public.rotation_rounds drop constraint if exists rotation_rounds_gpa_rule_check;
alter table public.rotation_rounds add constraint rotation_rounds_gpa_rule_check
  check (gpa_rule in ('off', 'same_band', 'band_or_close'));

-- ⛔ THE ONE HOME OF THE SWAP CRITERIA (unchanged signature; grants kept).
create or replace function public.rotation_pair_allowed(
  p_round text, a public.rotation_students, b public.rotation_students)
returns boolean language sql stable security definer set search_path = public as $$
  select a.id <> b.id
     and a.round_id = p_round and b.round_id = p_round
     and a.current_group <> b.current_group
     and a.gender = b.gender
     and case (select gpa_rule from public.rotation_rounds where id = p_round)
           when 'same_band' then public.rotation_gpa_band(a.gpa) is not null
                             and public.rotation_gpa_band(a.gpa) = public.rotation_gpa_band(b.gpa)
           when 'band_or_close' then a.gpa is not null and b.gpa is not null
                             and (   (public.rotation_gpa_band(a.gpa) is not null
                                      and public.rotation_gpa_band(a.gpa) = public.rotation_gpa_band(b.gpa))
                                  or abs(a.gpa - b.gpa) <= 0.20)
           else true
         end;
$$;

update public.rotation_rounds set gpa_rule = 'band_or_close', updated_at = now()
 where id = 'y6-2570' and gpa_rule = 'off';
