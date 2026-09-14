-- ============================================================
-- 0194 — an import may FILL the registry; it may not OVERWRITE it
--
-- REPORTED (2026-09-14, the owner, after the first real import): *"can you
-- update and check information in teamsamo for it to be sync with ระบบบ้าน
-- after this. are there mismatch, or some information not being filled, you
-- should sync it"*.
--
-- MEASURED. Of the 248 people who are in BOTH ทีม SAMO and ระบบบ้าน, **zero**
-- disagree about anything — there is no mismatch to resolve. But 136 of them
-- have a registry row with a NULL ชื่อ/นามสกุล while their ระบบบ้าน row has
-- both, and 78 students are missing a photo their own registry row holds. The
-- two systems are not in conflict; one of them simply never heard.
--
-- THE CAUSE, and it is one line. `student_insert_mirror_up` opens with:
--
--     if new.person_id is null or new.last_import_batch is not null
--       then return new; end if;
--
-- That is 0189's rule — an import must not overwrite a curated registry name —
-- implemented as "an import never writes UP AT ALL". The two are not the same
-- thing, and the difference is exactly the 136: a registry row holding NULL is
-- not a curated value being protected, it is a hole, and the file is the only
-- thing that has ever known what goes in it.
--
-- ⚠️ WHY THE BODY COULD NOT SIMPLY BE UN-SKIPPED. It coalesces the wrong way
-- round — `coalesce(new.first_name_th, p.first_name_th)` prefers the INCOMING
-- value, so running it on an import row would do precisely what 0189 forbade.
-- The fix is not to remove the guard but to give the import branch its own
-- write, with the coalesce reversed: `coalesce(p.x, new.x)`. The registry wins
-- wherever it has an opinion; the file fills the rest.
--
-- WHAT THIS DOES NOT DO. It does not touch `student_mirror_up` (the UPDATE
-- twin), which is correct as it stands: by the time a student row is UPDATED,
-- `students_link_person` has already given the registry's value precedence, so
-- what travels up is a value the registry either supplied or has no opinion on.
-- And it does not backfill — the trigger fires on new rows only. The repair for
-- the 136 already in the table is `tools/house-sync-registry.mjs`, which must be
-- run in batches because each registry write cascades through eleven triggers
-- (~0.9 s per person, measured — the whole set in one statement times out).
-- ============================================================

create or replace function public.student_insert_mirror_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is null then return new; end if;

  if new.last_import_batch is not null then
    -- ── THE IMPORT BRANCH (0194) ────────────────────────────────────────────
    -- FILL ONLY. Every column is `coalesce(REGISTRY, incoming)`, so a value the
    -- registry already holds is never touched and a hole is filled from the
    -- file. This is the same precedence `students_link_person` applies on the
    -- way in, stated once more here because this is a different write.
    --
    -- ⛔ Do not "simplify" this into the branch below by making the coalesce
    -- symmetric. The two branches differ in ONE thing and it is the direction
    -- of that coalesce, which is the whole subject of 0189.
    update public.people p
       set first_name_th = coalesce(p.first_name_th, new.first_name_th),
           last_name_th  = coalesce(p.last_name_th,  new.last_name_th),
           nickname      = coalesce(p.nickname,      new.nickname),
           student_id    = coalesce(p.student_id,    new.student_id),
           major         = coalesce(p.major,         new.major),
           cohort_year   = coalesce(p.cohort_year,   new.cohort_year)
     where p.id = new.person_id
       and (p.first_name_th, p.last_name_th, p.nickname,
            p.student_id, p.major, p.cohort_year)
           is distinct from
           (coalesce(p.first_name_th, new.first_name_th),
            coalesce(p.last_name_th,  new.last_name_th),
            coalesce(p.nickname,      new.nickname),
            coalesce(p.student_id,    new.student_id),
            coalesce(p.major,         new.major),
            coalesce(p.cohort_year,   new.cohort_year));
    return new;
  end if;

  -- ── THE ORDINARY BRANCH, unchanged ──────────────────────────────────────
  -- A row created by hand or by a claim: the incoming value is the newest thing
  -- anyone has said, so it wins over an empty registry column but not over a
  -- filled one — which is what this coalesce already expresses.
  update public.people p
     set first_name_th = coalesce(new.first_name_th, p.first_name_th),
         last_name_th  = coalesce(new.last_name_th,  p.last_name_th),
         nickname      = coalesce(new.nickname,      p.nickname),
         student_id    = coalesce(new.student_id,    p.student_id),
         major         = coalesce(new.major,         p.major),
         cohort_year   = coalesce(new.cohort_year,   p.cohort_year)
   where p.id = new.person_id
     and (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major, p.cohort_year)
         is distinct from
         (coalesce(new.first_name_th, p.first_name_th),
          coalesce(new.last_name_th,  p.last_name_th),
          coalesce(new.nickname,      p.nickname),
          coalesce(new.student_id,    p.student_id),
          coalesce(new.major,         p.major),
          coalesce(new.cohort_year,   p.cohort_year));
  return new;
end;
$$;

comment on function public.student_insert_mirror_up() is
  'Carries a NEW ระบบบ้าน row up to the registry. An IMPORT row fills only where '
  'the registry is empty (0194); anything else prefers the incoming value. The '
  'two branches differ only in the direction of the coalesce, and that direction '
  'is 0189''s rule: the registry wins wherever it has an opinion.';
