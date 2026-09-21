-- ============================================================
-- house0200-three-copies.sql — the main card, ทีม SAMO and ระบบบ้าน hold the
-- same values, a placement CONNECTED to an existing person takes that person's,
-- and an admin can see and repair any disagreement. Rolled back.
--   node tools/db-query.mjs tools/house0200-three-copies.sql
-- RUN BEFORE 0200 AND IT FAILS: 01 (38 real rows), 10–11 (the new posting keeps
-- its blanks), 20 (photo-only edit ignored), 30+ (no functions).
-- ============================================================
begin;
create temporary table probe (step text, expected text, got text) on commit drop;
do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;
grant insert, select on probe to authenticated, anon;

-- 01 — the live tables agree everywhere. Same predicate as person_mirror_down's
-- guards, written out here rather than calling 0200's function, so this line
-- is an independent witness of the function it guards.
insert into probe select '01. no placement disagrees with its main card', '0',
  ((select count(*) from public.team_members m join public.people p on p.id = m.person_id
     where (m.full_name, m.first_name_th, m.last_name_th, m.nickname, m.major, m.photo_url,
            m.photo_focus, m.student_id, m.cohort_year, m.year_offset, m.kkumail)
           is distinct from
           (p.full_name, p.first_name_th, p.last_name_th, p.nickname, p.major, p.photo_url,
            p.photo_focus, p.student_id, p.cohort_year, p.year_offset, p.kkumail))
 + (select count(*) from public.students s join public.people p on p.id = s.person_id
     where (s.first_name_th, s.last_name_th, s.nickname, s.student_id, s.major,
            s.cohort_year, s.year_offset, s.photo_url, s.photo_focus, s.bio)
           is distinct from
           (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major,
            p.cohort_year, p.year_offset, p.photo_url, p.photo_focus, p.bio)))::text;

-- A person who is in ระบบบ้าน and NOT in ทีม SAMO, with a cohort and a photo:
-- exactly the shape of the 2026-09-19 row.
-- CREATED, not found: dev holds one ระบบบ้าน row, and a proof whose subject
-- can run out goes silent (class 7). An ordinary insert — the link trigger
-- makes the person, exactly as an import does.
insert into public.students (kkumail, student_id, first_name_th, last_name_th, major, sai_code)
values ('h0200.probe@kkumail.com', '659999200-0', 'ทดสอบ', 'สามสำเนา', 'MD',
        (select code from public.sais order by code limit 1));
create temporary table subj on commit drop as
select person_id as id from public.students where kkumail = 'h0200.probe@kkumail.com';
-- An ordinary registry edit, so it reaches their ระบบบ้าน row the normal way.
update public.people set cohort_year = coalesce(cohort_year, 2565),
                         photo_url = coalesce(photo_url, 'https://probe0200/photo.jpg')
 where id = (select id from subj);
insert into probe select '02. made a house-only person', '1', (select count(*)::text from subj);

-- ── 10. a NEW ทีม SAMO posting for them, carrying only THEIR OWN name ─────
-- ⚠️ The name must be the one the registry already holds. A different name makes
-- the up-mirror CHANGE `people`, which fires the down-mirror and hides the bug —
-- the first version of this proof used 'probe0200' and passed before 0200.
-- The real case (2026-09-19) was a posting that told the registry nothing new.
insert into public.team_members (id, node_id, person_id, full_name, first_name_th, last_name_th)
select '00000000-0000-4000-8000-000000000200', (select id from public.team_nodes order by id limit 1),
       p.id, p.full_name, p.first_name_th, p.last_name_th
  from public.people p where p.id = (select id from subj);
insert into probe select '10. the new posting took the main card''s ปีที่เข้า', 'true',
  (select (m.cohort_year is not distinct from p.cohort_year and m.cohort_year is not null)::text
     from public.team_members m join public.people p on p.id = m.person_id
    where m.id = '00000000-0000-4000-8000-000000000200');
insert into probe select '11. …and its photo', 'true',
  (select (m.photo_url is not distinct from p.photo_url and m.photo_url is not null)::text
     from public.team_members m join public.people p on p.id = m.person_id
    where m.id = '00000000-0000-4000-8000-000000000200');

-- ── 20. a photo-only edit on the house side reaches the main card ─────────
update public.students set photo_url = 'https://probe0200/new.jpg'
 where person_id = (select id from subj);
insert into probe select '20. a photo-only ระบบบ้าน edit reached the main card', 'https://probe0200/new.jpg',
  (select photo_url from public.people where id = (select id from subj));
insert into probe select '21. …and from there, ทีม SAMO', 'https://probe0200/new.jpg',
  (select photo_url from public.team_members where id = '00000000-0000-4000-8000-000000000200');

-- ── 30. an admin can SEE a disagreement and REPAIR it ─────────────────────
-- Plant one with triggers off (the only way to make the copies disagree now).
set local session_replication_role = replica;
update public.team_members set photo_focus = null, cohort_year = null
 where id = '00000000-0000-4000-8000-000000000200';
update public.people set photo_focus = 'top' where id = (select id from subj);
set local session_replication_role = origin;

create temporary table adm on commit drop as
select u.id from public.users u where u.role = 'dev' order by u.id limit 1;
create temporary table plain on commit drop as
select u.id from public.users u
 where u.role = 'user' and coalesce(array_length(u.permissions,1),0) = 0
   and coalesce(array_length(u.managed_permissions,1),0) = 0 order by u.id limit 1;
grant select on adm, plain, subj to authenticated, anon;

-- DENY first: an ordinary account and anon.
select set_config('request.jwt.claims', json_build_object('sub', (select id from plain), 'role','authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin perform * from public.registry_mismatches();
    insert into probe values ('30. an ordinary account cannot list them', 'refused', 'ALLOWED');
  exception when others then insert into probe values ('30. an ordinary account cannot list them', 'refused', 'refused'); end;
  begin perform public.repair_registry_mismatches();
    insert into probe values ('31. …nor repair them', 'refused', 'ALLOWED');
  exception when others then insert into probe values ('31. …nor repair them', 'refused', 'refused'); end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin perform * from public.registry_mismatches();
    insert into probe values ('32. anon cannot list them', 'refused', 'ALLOWED');
  exception when others then insert into probe values ('32. anon cannot list them', 'refused', 'refused'); end;
end $$;
reset role;

-- ALLOW over the same rows: an admin sees the planted one, repairs it, sees none.
select set_config('request.jwt.claims', json_build_object('sub', (select id from adm), 'role','authenticated')::text, true);
set local role authenticated;
do $$ declare v text; n int; begin
 begin
  select array_to_string(columns, ',') into v from public.registry_mismatches()
   where placement_id = '00000000-0000-4000-8000-000000000200';
  insert into probe values ('33. an admin sees the planted disagreement, by column', 'photo_focus,cohort_year', coalesce(v, '(not listed)'));
  n := public.repair_registry_mismatches();
  insert into probe values ('34. repair touched at least that person', 'true', (n >= 1)::text);
  insert into probe values ('35. and afterwards nothing disagrees', '0',
    (select count(*)::text from public.registry_mismatches()));
 exception when others then insert into probe values ('33. an admin sees the planted disagreement, by column', 'photo_focus,cohort_year', 'ERROR: ' || sqlerrm);
 end;
end $$;
reset role;
insert into probe select '36. the repair filled from the main card, not the blank', 'top',
  (select photo_focus from public.team_members where id = '00000000-0000-4000-8000-000000000200');

select step, case when got is not distinct from expected then 'PASS' else 'FAIL' end as result, expected, got
  from probe order by step;
rollback;
