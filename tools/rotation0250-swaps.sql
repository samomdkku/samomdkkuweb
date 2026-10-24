-- ============================================================
-- rotation0250-swaps.sql — แลก Rotation: who can see what, and a swap happens
-- exactly once.
--
--   §A  the catalog: RLS on, anon holds nothing, students cannot read the roster
--   §B  visibility: outsider refused, unpublished round admin-only, a GPA never
--       reaches another student
--   §C  the swap: gender rule, duplicate, wrong person, accept, the other asks
--       closed, a broadcast taken by the FIRST accept only
--   §D  the GPA switch: off = ignored, same_band = enforced
--   §E  closed round, decline privacy, admin-only writes
--
-- Synthetic round 'proof-0250' over REAL users rows (the identity helper joins
-- public.users), everything inside a transaction that ROLLS BACK.
--   node tools/db-query.mjs tools/rotation0250-swaps.sql [--dev]
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;
grant insert, select on probe to authenticated, anon;

-- ── §A the catalog ──────────────────────────────────────────────────────────
insert into probe select '00. RLS on all five rotation tables', '5',
  (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace
     and relname in ('rotation_rounds','rotation_students','rotation_requests','rotation_moves','rotation_events')
     and relrowsecurity);
insert into probe select '01. anon holds NO privilege on any rotation table', 'false',
  (select bool_or(has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
               or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))::text
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'rotation\_%' and c.relkind = 'r');
insert into probe select '02. authenticated cannot SELECT the roster (it holds GPA)', 'false',
  (select has_table_privilege('authenticated', 'public.rotation_students', 'select')::text);
insert into probe select '03. anon cannot execute any rotation function', 'false',
  (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'rotation\_%');
insert into probe select '04. authenticated cannot call the GPA-comparing rule directly', 'false',
  (select has_function_privilege('authenticated',
     'public.rotation_pair_allowed(text, public.rotation_students, public.rotation_students)', 'execute')::text);

-- ── subjects ────────────────────────────────────────────────────────────────
create temporary table subj (k text primary key, uid uuid, email text) on commit drop;
grant select on subj to authenticated, anon;
insert into subj
select 'admin', u.id, lower(btrim(u.email)) from public.users u
 where u.email is not null
   and (u.role = 'dev'
        or 'rotation' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
        or 'master'   = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
 order by (u.role = 'dev') desc, u.id limit 1;
insert into subj
select k, id, email from (
  select row_number() over (order by u.id) as n, u.id, lower(btrim(u.email)) as email
    from public.users u
   where u.email is not null and btrim(u.email) <> ''
     and coalesce(u.role, 'user') not in ('dev')
     and not ('rotation' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
     and not ('master'   = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
     and not exists (select 1 from public.people p where p.user_id = u.id
                        and exists (select 1 from public.rotation_students s where s.person_id = p.id))
) t
cross join lateral (values (case n when 1 then 'm1' when 2 then 'm2' when 3 then 'm3'
                                   when 4 then 'f1' when 5 then 'out' end)) v(k)
where n <= 5;
insert into probe select '05. six subject accounts exist (admin + 5)', '6', (select count(*)::text from subj);

insert into public.rotation_rounds (id, title) values ('proof-0250', 'proof');
create temporary table sid (k text primary key, id uuid) on commit drop;
grant select on sid to authenticated, anon;
with ins as (
  insert into public.rotation_students (round_id, student_id, prefix, first_name, last_name, gender,
                                        original_group, current_group, kkumail)
  select 'proof-0250', x.sid, x.prefix, 'ทดสอบ', x.k, x.g, x.grp, x.grp, s.email
    from (values ('m1','999000001-1','นาย','M','A'), ('m2','999000002-1','นาย','M','B'),
                 ('m3','999000003-1','นาย','M','B'), ('f1','999000004-1','นางสาว','F','B')) x(k,sid,prefix,g,grp)
    join subj s on s.k = x.k
  returning id, last_name)
insert into sid select last_name, id from ins;

create or replace function pg_temp.as_(p_k text) returns void language sql as $$
  select set_config('request.jwt.claims',
    (select json_build_object('sub', uid, 'role', 'authenticated', 'email', email)::text from subj where k = p_k), true);
$$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql into v; return coalesce(v, 'ok');
exception when others then return 'raised: ' || sqlerrm; end $$;
grant execute on function pg_temp.try(text) to authenticated, anon;
grant execute on function pg_temp.as_(text) to authenticated, anon;
create temporary table r (k text, v text) on commit drop;
grant insert, select on r to authenticated, anon;

-- ── §B visibility ───────────────────────────────────────────────────────────
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'm1_unpub', public.rotation_board('proof-0250')->>'state';
reset role;
select pg_temp.as_('out'); set local role authenticated;
insert into r select 'out_unpub', public.rotation_board('proof-0250')->>'state';
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'admin_unpub', public.rotation_board('proof-0250')->>'state';
insert into r select 'admin_open', public.rotation_admin_update_round('proof-0250', true, true, null, null)->>'ok';
reset role;
insert into probe select '10. member, unpublished round: not_published', 'not_published', (select v from r where k = 'm1_unpub');
insert into probe select '11. outsider: not_in_roster', 'not_in_roster', (select v from r where k = 'out_unpub');
insert into probe select '12. admin sees an unpublished round (the ALLOW)', 'ok', (select v from r where k = 'admin_unpub');
insert into probe select '13. admin opens the round', 'true', (select v from r where k = 'admin_open');

select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'm2_gpa', public.rotation_set_gpa('proof-0250', 3.17)->>'gpa_band';
insert into r select 'm2_self_gpa', public.rotation_board('proof-0250')->'me'->>'gpa';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'm1_board', public.rotation_board('proof-0250')::text;
insert into r select 'm1_roster', pg_temp.try('select count(*)::text from public.rotation_students');
insert into r select 'm1_events', (select count(*)::text from public.rotation_events where round_id = 'proof-0250');
reset role;
select pg_temp.as_('out'); set local role authenticated;
insert into r select 'out_board', public.rotation_board('proof-0250')->>'state';
insert into r select 'out_events', (select count(*)::text from public.rotation_events where round_id = 'proof-0250');
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'admin_board', public.rotation_board('proof-0250')::text;
reset role;
insert into probe select '14. a student stores their GPA and reads it back', '3.17', (select v from r where k = 'm2_self_gpa');
insert into probe select '15. … its band', '3.00-3.49', (select v from r where k = 'm2_gpa');
insert into probe select '16. member board is ok and lists 4 students (control)', 'ok/4',
  (select (v::jsonb->>'state') || '/' || jsonb_array_length(v::jsonb->'students') from r where k = 'm1_board');
insert into probe select '17. … and carries NO other student''s GPA', 'false',
  (select (v like '%3.17%' or exists (select 1 from jsonb_array_elements(v::jsonb->'students') e where e ? 'gpa'))::text
     from r where k = 'm1_board');
insert into probe select '18. admin board DOES carry it (control for 17)', 'true',
  (select (v like '%3.17%')::text from r where k = 'admin_board');
insert into probe select '19. a student reading the roster table is refused', 'true',
  (select (v like 'raised: permission denied%')::text from r where k = 'm1_roster');
insert into probe select '20. member receives the realtime pings', 'true', (select (v::int > 0)::text from r where k = 'm1_events');
insert into probe select '21. outsider receives none, and no board', '0/not_in_roster',
  (select (select v from r where k = 'out_events') || '/' || (select v from r where k = 'out_board'));
insert into probe select '22. can_swap: m1 (M,A) with f1 (F,B) is false, with m2 (M,B) true', 'false/true',
  (select (select e->>'can_swap' from jsonb_array_elements(v::jsonb->'students') e where e->>'last_name' = 'f1')
       || '/' || (select e->>'can_swap' from jsonb_array_elements(v::jsonb->'students') e where e->>'last_name' = 'm2')
     from r where k = 'm1_board');

-- ── §C the swap ─────────────────────────────────────────────────────────────
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'req_f1',   public.rotation_request('proof-0250', (select id from sid where k='f1'), null)->>'reason';
insert into r select 'req_m2',   public.rotation_request('proof-0250', (select id from sid where k='m2'), null)::text;
insert into r select 'req_dup',  public.rotation_request('proof-0250', (select id from sid where k='m2'), null)->>'reason';
insert into r select 'req_bc',   public.rotation_request('proof-0250', null, 'B')::text;
insert into r select 'req_same', public.rotation_request('proof-0250', null, 'A')->>'reason';
reset role;
insert into probe select '30. different gender is refused', 'not_eligible', (select v from r where k = 'req_f1');
insert into probe select '31. same gender, other group: requested', 'true', (select (v::jsonb->>'ok') from r where k = 'req_m2');
insert into probe select '32. the same ask twice is refused', 'duplicate', (select v from r where k = 'req_dup');
insert into probe select '33. a broadcast to group B', 'true', (select (v::jsonb->>'ok') from r where k = 'req_bc');
insert into probe select '34. a broadcast to your own group is refused', 'same_group', (select v from r where k = 'req_same');

select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'm3_steal', public.rotation_accept((select (v::jsonb->>'id')::uuid from r where k = 'req_m2'))->>'reason';
reset role;
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'm2_accept', public.rotation_accept((select (v::jsonb->>'id')::uuid from r where k = 'req_m2'))::text;
reset role;
insert into probe select '35. someone else cannot accept a named ask', 'not_yours', (select v from r where k = 'm3_steal');
insert into probe select '36. the named person accepts', 'true', (select v::jsonb->>'ok' from r where k = 'm2_accept');
insert into probe select '37. they swapped groups', 'B/A',
  (select (select current_group from public.rotation_students where id = (select id from sid where k='m1'))
     || '/' || (select current_group from public.rotation_students where id = (select id from sid where k='m2')));
insert into probe select '38. m1''s broadcast was closed by the swap', 'superseded',
  (select status from public.rotation_requests where id = (select (v::jsonb->>'id')::uuid from r where k = 'req_bc'));
insert into probe select '39. two move rows were logged', '2',
  (select count(*)::text from public.rotation_moves where round_id = 'proof-0250');
insert into probe select '40. the groups stay the same size', 'A:1 B:3',
  (select string_agg(g || ':' || n, ' ' order by g) from
     (select current_group g, count(*) n from public.rotation_students where round_id = 'proof-0250' group by 1) t);

-- Broadcast taken by the FIRST accept only. m2 is now in A; m1 + m3 in B.
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'bc2', public.rotation_request('proof-0250', null, 'B')::text;
reset role;
select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'bc2_m3', public.rotation_accept((select (v::jsonb->>'id')::uuid from r where k = 'bc2'))->>'ok';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'bc2_m1', public.rotation_accept((select (v::jsonb->>'id')::uuid from r where k = 'bc2'))->>'reason';
reset role;
insert into probe select '41. first accept of a broadcast wins', 'true', (select v from r where k = 'bc2_m3');
insert into probe select '42. the second accept finds it taken', 'taken', (select v from r where k = 'bc2_m1');
insert into probe select '43. after it: m2 B, m3 A, m1 still B', 'B/A/B',
  (select string_agg(current_group, '/' order by array_position(array['m2','m3','m1'], last_name))
     from public.rotation_students where round_id = 'proof-0250' and last_name in ('m1','m2','m3'));

-- ── §D the GPA switch ───────────────────────────────────────────────────────
select pg_temp.as_('m1'); set local role authenticated;   -- m1: B, no GPA
insert into r select 'gpa_off', public.rotation_request('proof-0250', (select id from sid where k='m3'), null)->>'ok';
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'rule_on', public.rotation_admin_update_round('proof-0250', null, null, null, 'same_band')->>'ok';
reset role;
select pg_temp.as_('m3'); set local role authenticated;   -- m3: A
insert into r select 'm3_gpa', public.rotation_set_gpa('proof-0250', 2.80)->>'gpa_band';
insert into r select 'gpa_far', public.rotation_request('proof-0250', null, 'B')->>'reason';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'm1_gpa', public.rotation_set_gpa('proof-0250', 2.99)->>'gpa_band';
reset role;
select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'gpa_near', public.rotation_request('proof-0250', (select id from sid where k='m1'), null)::text;
reset role;
insert into probe select '50. gpa_rule off: no GPA is no obstacle', 'true', (select v from r where k = 'gpa_off');
insert into probe select '51. admin turns the band rule on', 'true', (select v from r where k = 'rule_on');
insert into probe select '52. rule on: 2.80 cannot reach a group of 3.17 + no-GPA', 'nobody_eligible', (select v from r where k = 'gpa_far');
insert into probe select '53. rule on: 2.80 with 2.99 (same band) may ask', 'true', (select v::jsonb->>'ok' from r where k = 'gpa_near');

-- ── §E closed round, decline privacy, admin-only ────────────────────────────
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'decline', public.rotation_respond_no(
  (select (v::jsonb->>'id')::uuid from r where k = 'gpa_near'))->>'ok';
reset role;
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'm2_sees_declined', (select count(*)::text from jsonb_array_elements(
  public.rotation_board('proof-0250')->'requests') e where e->>'status' = 'declined');
insert into r select 'm2_admin', pg_temp.try($q$select public.rotation_admin_update_round('proof-0250', false, false, null, 'off')::text$q$);
insert into r select 'm2_move', pg_temp.try(format($q$select public.rotation_admin_move(%L, 'A')::text$q$, (select id from sid where k='m2')));
reset role;
select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'm3_sees_declined', (select count(*)::text from jsonb_array_elements(
  public.rotation_board('proof-0250')->'requests') e where e->>'status' = 'declined');
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'close', public.rotation_admin_update_round('proof-0250', null, false, null, 'off')->>'ok';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'closed_req', public.rotation_request('proof-0250', (select id from sid where k='m3'), null)->>'reason';
reset role;
insert into probe select '60. the named person declines', 'true', (select v from r where k = 'decline');
insert into probe select '61. a bystander does not see the decline', '0', (select v from r where k = 'm2_sees_declined');
insert into probe select '62. the asker does (control for 61)', '1', (select v from r where k = 'm3_sees_declined');
insert into probe select '63. a student cannot change the round', 'true',
  (select (v like 'raised: ROTATION_ADMIN_ONLY%')::text from r where k = 'm2_admin');
insert into probe select '64. a student cannot move anyone', 'true',
  (select (v like 'raised: ROTATION_ADMIN_ONLY%')::text from r where k = 'm2_move');
insert into probe select '65. a closed round takes no asks', 'closed', (select v from r where k = 'closed_req');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
