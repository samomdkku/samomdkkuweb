-- ============================================================
-- rotation0265-contact-email.sql — แลก Rotation: a classmate's kkumail, one at
-- a time, only to someone who could swap with them.
--
--   ALLOW: a same-gender classmate on the published roster; a rotation admin
--          (anyone, any gender)
--   DENY : the other gender, yourself, an outsider, an unpublished round, a
--          student of ANOTHER round named through this one, anon
--
-- Synthetic round 'proof-0265' over REAL users rows, everything ROLLS BACK.
--   node tools/db-query.mjs tools/rotation0265-contact-email.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

insert into probe select '01. anon cannot execute it', 'false',
  (select has_function_privilege('anon', 'public.rotation_contact_email(text, uuid)', 'execute')::text);
insert into probe select '02. authenticated can (the ALLOW for 01)', 'true',
  (select has_function_privilege('authenticated', 'public.rotation_contact_email(text, uuid)', 'execute')::text);

-- ── subjects: one admin, three students (M, M, F), one outsider ────────────
create temporary table subj (k text primary key, uid uuid, email text) on commit drop;
grant select on subj to authenticated, anon;
insert into subj
select 'admin', u.id, lower(btrim(u.email)) from public.users u
 where u.email is not null and btrim(u.email) <> ''
 order by u.id limit 1;
insert into subj
select k, id, email from (
  select row_number() over (order by u.id) as n, u.id, lower(btrim(u.email)) as email
    from public.users u
   where u.email is not null and btrim(u.email) <> ''
     and u.id <> (select uid from subj where k = 'admin')
     and coalesce(u.role, 'user') <> 'dev'
     and not exists (select 1 from public.rotation_admins a where a.user_id = u.id)
     and not exists (select 1 from public.people p where p.user_id = u.id
                        and exists (select 1 from public.rotation_students s where s.person_id = p.id))
) t
cross join lateral (values (case n when 1 then 'm1' when 2 then 'm2' when 3 then 'f1' when 4 then 'out' end)) v(k)
where n <= 4;
insert into probe select '03. five subject accounts exist', '5', (select count(*)::text from subj);
insert into public.rotation_admins (user_id, note) select uid, 'proof' from subj where k = 'admin'
  on conflict do nothing;

insert into public.rotation_rounds (id, title) values ('proof-0265', 'proof');   -- published = false
create temporary table sid (k text primary key, id uuid) on commit drop;
grant select on sid to authenticated, anon;
with ins as (
  insert into public.rotation_students (round_id, student_id, prefix, first_name, last_name, gender,
                                        original_group, current_group, kkumail)
  select 'proof-0265', x.sid, x.prefix, 'ทดสอบ', x.k, x.g, x.grp, x.grp, s.email
    from (values ('m1','999026501-1','นาย','M','A'), ('m2','999026502-1','นาย','M','B'),
                 ('f1','999026503-1','นางสาว','F','B')) x(k,sid,prefix,g,grp)
    join subj s on s.k = x.k
  returning id, last_name)
insert into sid select last_name, id from ins;
-- a real student of ANOTHER round (looked up as the owner; a student cannot read the roster)
insert into sid select 'other', coalesce((select id from public.rotation_students where round_id <> 'proof-0265' limit 1),
                                          gen_random_uuid());

create or replace function pg_temp.as_(p_k text) returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', uid, 'role', 'authenticated', 'email', email)::text from subj where k = p_k), true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return v;
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.as_(text) to authenticated, anon;
grant execute on function pg_temp.try(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- unpublished round: a member is refused
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'unpub', public.rotation_contact_email('proof-0265', (select id from sid where k='m2'))::text;
reset role;

update public.rotation_rounds set published = true where id = 'proof-0265';

select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'm1_m2',   public.rotation_contact_email('proof-0265', (select id from sid where k='m2'))::text;
insert into r select 'm1_f1',   public.rotation_contact_email('proof-0265', (select id from sid where k='f1'))::text;
insert into r select 'm1_self', public.rotation_contact_email('proof-0265', (select id from sid where k='m1'))::text;
-- a real student of another round, named through this round
insert into r select 'm1_other', public.rotation_contact_email('proof-0265', (select id from sid where k='other'))::text;
reset role;
select pg_temp.as_('out'); set local role authenticated;
insert into r select 'out', pg_temp.try(format($q$select public.rotation_contact_email('proof-0265', %L)::text$q$,
  (select id from sid where k='m2')));
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'admin_f1', public.rotation_contact_email('proof-0265', (select id from sid where k='f1'))::text;
reset role;

insert into probe select '10. unpublished round: a member is refused', 'closed',
  (select v::jsonb->>'reason' from r where k = 'unpub');
insert into probe select '11. same gender: the classmate''s kkumail (the ALLOW)', 'true',
  (select (v::jsonb->>'kkumail' = (select email from subj where k = 'm2'))::text from r where k = 'm1_m2');
insert into probe select '12. other gender is refused', 'not_eligible',
  (select v::jsonb->>'reason' from r where k = 'm1_f1');
insert into probe select '13. … and the refusal carries no address', 'false',
  (select (v like '%' || (select email from subj where k = 'f1') || '%')::text from r where k = 'm1_f1');
insert into probe select '14. yourself is refused', 'not_eligible',
  (select v::jsonb->>'reason' from r where k = 'm1_self');
insert into probe select '15. another round''s student cannot be read through this round', 'no_such_student',
  (select v::jsonb->>'reason' from r where k = 'm1_other');
insert into probe select '16. an outsider is refused', 'true',
  (select (v like 'raised: ROTATION_NOT_IN_ROSTER%')::text from r where k = 'out');
insert into probe select '17. a rotation admin reads any student (the ALLOW for 12)', 'true',
  (select (v::jsonb->>'kkumail' = (select email from subj where k = 'f1'))::text from r where k = 'admin_f1');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
