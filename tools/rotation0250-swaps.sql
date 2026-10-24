-- ============================================================
-- rotation0250-swaps.sql — แลก Rotation: who can see what, and a swap happens
-- exactly once.
--
--   §A  the catalog: RLS on, anon holds nothing, students cannot read the roster
--   §B  visibility: outsider refused, unpublished round admin-only, a GPA never
--       reaches ANYONE but its owner — admins included since 0251 (they get a
--       count)
--   §C  the swap: gender rule, duplicate, wrong person, accept, the other asks
--       closed, a broadcast taken by the FIRST accept only
--   §D  the GPA switch: off = ignored, same_band = enforced
--   §E  closed round, decline privacy, admin-only writes
--   §F  contact (0251): owner writes it, the cohort reads it, 200-char cap
--   §G  "I want to stay here" (0252): closes what is in flight, nobody can ask
--       them, they cannot ask, a broadcast does not count them; off = allowed
--   §H  the faculty's rule (0253): same band, OR at most 0.20 apart; no GPA = no
--   §I  named GPA viewers (0254): only a listed ACCOUNT reads every GPA — an
--       admin/master off the list still reads none (case 18)
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
insert into probe select '18. admin board carries NO GPA either (0251, owner)', 'false',
  (select (v like '%3.17%' or exists (select 1 from jsonb_array_elements(v::jsonb->'students') e where e ? 'gpa'))::text
     from r where k = 'admin_board');
insert into probe select '18b. … only the count, which DID see the stored GPA (control for 17/18)', '1',
  (select v::jsonb->'round'->>'gpa_filled' from r where k = 'admin_board');
insert into probe select '18c. a student board carries no gpa_filled', 'false',
  (select (v::jsonb->'round' ? 'gpa_filled')::text from r where k = 'm1_board');
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

-- ── §F contact (0251) ───────────────────────────────────────────────────────
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'c_set', public.rotation_set_contact('proof-0250', E'  LINE: proof0251\n IG: x ')->>'contact';
insert into r select 'c_long', public.rotation_set_contact('proof-0250', repeat('x', 201))->>'reason';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'c_seen', (select e->>'contact' from jsonb_array_elements(public.rotation_board('proof-0250')->'students') e
                                  where e->>'id' = (select id::text from sid where k = 'm2'));
insert into r select 'c_keys', (select bool_and(e ? 'nickname' and e ? 'contact')::text
                                  from jsonb_array_elements(public.rotation_board('proof-0250')->'students') e);
reset role;
select pg_temp.as_('out'); set local role authenticated;
insert into r select 'c_out', public.rotation_board('proof-0250')::text;
insert into r select 'c_out_set', pg_temp.try($q$select public.rotation_set_contact('proof-0250', 'x')::text$q$);
reset role;
insert into probe select '70. contact is stored on one line, trimmed', 'LINE: proof0251 IG: x', (select v from r where k = 'c_set');
insert into probe select '71. a classmate reads it (the ALLOW)', 'LINE: proof0251 IG: x', (select v from r where k = 'c_seen');
insert into probe select '72. every student row names nickname + contact', 'true', (select v from r where k = 'c_keys');
insert into probe select '73. an outsider''s board does not carry it', 'false', (select (v like '%proof0251%')::text from r where k = 'c_out');
insert into probe select '74. an outsider cannot write one', 'true',
  (select (v like 'raised: ROTATION_NOT_IN_ROSTER%')::text from r where k = 'c_out_set');
insert into probe select '75. 201 characters is refused', 'too_long', (select v from r where k = 'c_long');

-- ── §G staying (0252). State here: m1 B, m2 B, m3 A; m1→m3 still pending. ──
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'g_open', public.rotation_admin_update_round('proof-0250', null, true, null, 'off')->>'ok';
reset role;
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'g_m2m3', public.rotation_request('proof-0250', (select id from sid where k='m3'), null)::text;
reset role;
select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'g_stay', public.rotation_set_staying('proof-0250', true)::text;
insert into r select 'g_m3_asks', public.rotation_request('proof-0250', (select id from sid where k='m2'), null)->>'reason';
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'g_m1_asks', public.rotation_request('proof-0250', (select id from sid where k='m3'), null)->>'reason';
insert into r select 'g_m1_board', (select (e->>'staying') || '/' || (e->>'can_swap')
  from jsonb_array_elements(public.rotation_board('proof-0250')->'students') e where e->>'last_name' = 'm3');
reset role;
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'g_bc', public.rotation_request('proof-0250', null, 'A')->>'reason';
reset role;
select pg_temp.as_('m3'); set local role authenticated;
insert into r select 'g_unstay', public.rotation_set_staying('proof-0250', false)->>'staying';
insert into r select 'g_m3_asks2', public.rotation_request('proof-0250', (select id from sid where k='m2'), null)->>'ok';
reset role;
insert into probe select '80. round reopened for §G', 'true', (select v from r where k = 'g_open');
insert into probe select '81. staying declines the 2 asks naming them, cancels none of theirs', '2/0',
  (select (v::jsonb->>'declined') || '/' || (v::jsonb->>'cancelled') from r where k = 'g_stay');
insert into probe select '82. … the ask m2 had sent is now declined', 'declined',
  (select status from public.rotation_requests where id = (select (v::jsonb->>'id')::uuid from r where k = 'g_m2m3'));
insert into probe select '83. nobody can name a staying person', 'staying', (select v from r where k = 'g_m1_asks');
insert into probe select '84. a staying person cannot ask', 'you_staying', (select v from r where k = 'g_m3_asks');
insert into probe select '85. the board says staying, and nobody may ask them', 'true/false', (select v from r where k = 'g_m1_board');
insert into probe select '86. a broadcast does not count a staying person', 'nobody_eligible', (select v from r where k = 'g_bc');
insert into probe select '87. switching it off (the ALLOW): they may ask again', 'false/true',
  (select (select v from r where k = 'g_unstay') || '/' || (select v from r where k = 'g_m3_asks2'));

-- ── §H band_or_close (0253). m1 B 2.99, m2 B 3.17, m3 A 2.80; m3→m2 pending. ─
create or replace function pg_temp.can(p_who text, p_whom text) returns text language sql as $$
  select e->>'can_swap' from jsonb_array_elements(public.rotation_board('proof-0250')->'students') e
   where e->>'last_name' = p_whom $$;
grant execute on function pg_temp.can(text, text) to authenticated;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'h_on', public.rotation_admin_update_round('proof-0250', null, null, null, 'band_or_close')->>'ok';
reset role;
insert into r select 'h_req', id::text from public.rotation_requests where round_id = 'proof-0250'
   and status = 'pending' and requester_id = (select id from sid where k='m3') and target_id = (select id from sid where k='m2');
select pg_temp.as_('m2'); set local role authenticated;
insert into r select 'h_far', public.rotation_accept((select v::uuid from r where k = 'h_req'))->>'reason';
insert into r select 'h_set300', public.rotation_set_gpa('proof-0250', 3.00)->>'ok';
insert into r select 'h_edge', public.rotation_accept((select v::uuid from r where k = 'h_req'))->>'ok';
reset role;
-- now m2 A 3.00, m3 B 2.80, m1 B 2.99
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'h_close', pg_temp.can('m1', 'm2');
select public.rotation_set_gpa('proof-0250', null);
insert into r select 'h_nogpa', pg_temp.can('m1', 'm2');
select public.rotation_set_gpa('proof-0250', 3.30);
reset role;
select pg_temp.as_('m2'); set local role authenticated;
select public.rotation_set_gpa('proof-0250', 3.60);
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'h_33_36', pg_temp.can('m1', 'm2');
reset role;
select pg_temp.as_('m2'); set local role authenticated;
select public.rotation_set_gpa('proof-0250', 3.50);
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'h_33_35', pg_temp.can('m1', 'm2');
reset role;
select pg_temp.as_('m2'); set local role authenticated;
select public.rotation_set_gpa('proof-0250', 3.51);
reset role;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'h_33_351', pg_temp.can('m1', 'm2');
reset role;
insert into probe select '90. admin selects band_or_close', 'true', (select v from r where k = 'h_on');
insert into probe select '91. 2.80 ↔ 3.17: other band and 0.37 apart → refused at ACCEPT', 'not_eligible', (select v from r where k = 'h_far');
insert into probe select '92. 2.80 ↔ 3.00: other band but exactly 0.20 apart → swaps', 'true', (select v from r where k = 'h_edge');
insert into probe select '93. 2.99 ↔ 3.00: other band, 0.01 apart → may ask', 'true', (select v from r where k = 'h_close');
insert into probe select '94. no GPA → may not ask', 'false', (select v from r where k = 'h_nogpa');
insert into probe select '95. the owner''s example 3.3 ↔ 3.6 → no', 'false', (select v from r where k = 'h_33_36');
insert into probe select '96. 3.30 ↔ 3.50 (0.20) → yes', 'true', (select v from r where k = 'h_33_35');
insert into probe select '97. 3.30 ↔ 3.51 (0.21) → no', 'false', (select v from r where k = 'h_33_351');

-- ── §I named GPA viewers (0254) ─────────────────────────────────────────────
insert into probe select '100. nobody can read the viewer list through the API', 'false',
  (select has_table_privilege('authenticated', 'public.rotation_gpa_viewers', 'select')::text);
insert into public.rotation_gpa_viewers (user_id, note) select uid, 'proof' from subj where k = 'm1'
  on conflict do nothing;
select pg_temp.as_('m1'); set local role authenticated;
insert into r select 'i_m1', public.rotation_board('proof-0250')::text;
reset role;
select pg_temp.as_('admin'); set local role authenticated;
insert into r select 'i_admin', public.rotation_board('proof-0250')::text;
reset role;
insert into probe select '101. a listed account reads every student''s GPA (the ALLOW)', 'true/3.51',
  (select (v::jsonb->>'gpa_viewer') || '/' || (select e->>'gpa' from jsonb_array_elements(v::jsonb->'students') e where e->>'last_name' = 'm2')
     from r where k = 'i_m1');
insert into probe select '102. an admin/master off the list still reads none', 'false/false',
  (select (v::jsonb->>'gpa_viewer') || '/' || exists (select 1 from jsonb_array_elements(v::jsonb->'students') e where e ? 'gpa')::text
     from r where k = 'i_admin');

select step,
       case when got is not distinct from expected then 'PASS' else 'FAIL' end as result,
       expected, got
  from probe order by step;

rollback;
