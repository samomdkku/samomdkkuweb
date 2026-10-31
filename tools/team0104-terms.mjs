// 0104 proof: ปีการศึกษา snapshots publish faithfully, stay editable, and
// publish NOTHING beyond what get_public_team_chart() already named.
//
// The three things that would actually hurt if they broke:
//   1. The snapshot flattens the tree. publish_team_term re-keys every node to a
//      fresh uuid inside one CTE; if `as materialized` were dropped, each
//      reference to that CTE would generate DIFFERENT uuids, every parent lookup
//      would return null, and the archive would silently become a flat list. No
//      error — just a wrong org chart.
//   2. A non-public subtree (อาจารย์, เจ้าหน้าที่คณะ) leaks into the archive and
//      therefore onto the public page.
//   3. The archive tables become directly readable, or a column beyond the
//      projection's allow-list reaches anon.
//
// Plus the grant-channel checks this repo keeps re-learning: the `team`
// permission must work on the new tables (0089's lesson applied to writes AND
// reads), and the definer RPC's guard must fail CLOSED on a null role.
//
// Self-provisioning; every check runs in one rolled-back transaction.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 300)); } };
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
const kv = (r) => Object.fromEntries(rowsOf(r).filter((x) => 'k' in x).map((x) => [x.k, x.v]));

// A scratch year far outside anything real, so a failed rollback cannot collide
// with a term the org actually uses.
const Y = 2599;

let UID; let EMAIL;

/** Run `sql` as a role='user' account holding `perms` through a REAL tree
 *  binding. Poking users.managed_permissions directly does not survive: any
 *  write to team_nodes fires the recompute trigger, which rebuilds it from the
 *  tree and wipes a grant with nothing behind it. */
const asTreeGrant = (perms, sql) => mgmt(`
  begin;
  create temp table out(k text, v text);
  grant all on out to authenticated, anon;
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  with n as (
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0104-GRANTOR', 'role', ${perms}) returning id
  )
  insert into public.team_members (node_id, full_name, kkumail)
  select n.id, 'ZZ-0104-GRANTEE', ${lit(EMAIL)} from n;
  select public.sync_my_team_permissions();
  set local role authenticated;
  ${sql}
  reset role;
  select * from out;
  rollback;`);

async function main() {
  console.log('project', REF, '\n');

  const who = (await mgmt(`select id, email from public.users
     where coalesce(role,'user')='user' and email is not null order by id limit 1`)).body?.[0];
  UID = who?.id; EMAIL = who?.email;
  if (!UID || !EMAIL) { console.log('no plain user with an email to test with'); process.exit(1); }
  console.log('grantee:', EMAIL, '\n');

  // ── 1. Snapshot fidelity ─────────────────────────────────────────────────
  console.log('SNAPSHOT');
  const snap = await mgmt(`
    begin;
    create temp table out(k text, v text);
    grant all on out to authenticated, anon;
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    insert into out select 'publish', public.publish_team_term(${Y})::text;
    reset role;

    insert into out select 'orphan_parents', count(*)::text
      from public.team_archive_nodes c
     where c.year=${Y} and c.parent_id is not null
       and not exists (select 1 from public.team_archive_nodes p where p.id=c.parent_id);

    insert into out select 'roots_match', (
      (select count(*) from public.team_archive_nodes where year=${Y} and parent_id is null)
      = (select count(*) from public.team_nodes where parent_id is null and is_public))::text;

    insert into out select 'depth_match', (
      (select max(d) from (with recursive w as (
         select id,0 d from public.team_archive_nodes where year=${Y} and parent_id is null
         union all select c.id,w.d+1 from public.team_archive_nodes c join w on c.parent_id=w.id
          where c.year=${Y}) select d from w) a)
      = (select max(d) from (with recursive w as (
         select id,0 d from public.team_nodes where parent_id is null and is_public
         union all select c.id,w.d+1 from public.team_nodes c join w on c.parent_id=w.id
          where c.is_public) select d from w) b))::text;

    insert into out select 'board_carried', (
      (select count(*) from public.team_archive_nodes where year=${Y} and is_board)
      = (select count(*) from public.team_nodes n where n.is_board and n.is_public
          and exists (with recursive v as (
                select id from public.team_nodes where parent_id is null and is_public
                union all select c.id from public.team_nodes c join v on c.parent_id=v.id
                 where c.is_public) select 1 from v where v.id=n.id)))::text;

    -- The whole point of the is_public filter: nobody under a hidden subtree may
    -- become published by being archived.
    insert into out select 'nonpublic_excluded', (not exists (
      select 1 from public.team_archive_members am
       where am.year=${Y}
         and am.full_name in (select m.full_name from public.team_members m
                                join public.team_nodes n on n.id=m.node_id
                               where n.is_public = false)))::text;

    -- Re-publishing must REPLACE, not accumulate.
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    select public.publish_team_term(${Y});
    reset role;
    insert into out select 'republish_replaces', (
      (select count(*) from public.team_archive_nodes where year=${Y})
      = (select count(*) from public.team_nodes n where n.is_public
          and exists (with recursive v as (
                select id from public.team_nodes where parent_id is null and is_public
                union all select c.id from public.team_nodes c join v on c.parent_id=v.id
                 where c.is_public) select 1 from v where v.id=n.id)))::text;

    select * from out;
    rollback;`);
  const s = kv(snap);
  check('publish returns a count', /"nodes":\s*\d+/.test(s.publish || ''), JSON.stringify(snap.body).slice(0, 300));
  check('hierarchy survives the uuid re-map (0 orphan parents)', s.orphan_parents === '0', s.orphan_parents);
  check('root count matches the live public tree', s.roots_match === 'true');
  check('max depth matches — the tree was NOT flattened', s.depth_match === 'true');
  check('is_board flags carried into the archive', s.board_carried === 'true');
  check('members of non-public subtrees are excluded', s.nonpublic_excluded === 'true');
  check('re-publishing replaces rather than accumulates', s.republish_replaces === 'true');

  // ── 2. The projection publishes only the allow-list ──────────────────────
  console.log('\nPROJECTION');
  const proj = await mgmt(`
    begin;
    create temp table out(k text, v text);
    grant all on out to authenticated, anon;
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    select public.publish_team_term(${Y});
    reset role;

    set local role anon;
    select set_config('request.jwt.claims','',true);
    -- Serialize the WHOLE chart and look for anything that must never be in it.
    insert into out select 'has_at',        (public.get_public_team_chart(${Y})::text like '%@%')::text;
    insert into out select 'has_studentid', (public.get_public_team_chart(${Y})::text ~ '"student_id"')::text;
    insert into out select 'has_kkumail',   (public.get_public_team_chart(${Y})::text ~ '"kkumail"')::text;
    insert into out select 'has_perms',     (public.get_public_team_chart(${Y})::text ~ '"permissions"|"vs_dept"|"project_seat"|"passport_')::text;
    insert into out select 'keys', (select string_agg(distinct k, ',' order by k)
      from (select jsonb_object_keys(e) k from jsonb_array_elements(public.get_public_team_chart(${Y})->'members') e) z);
    insert into out select 'archive_rows',  count(*)::text from public.team_archive_members;
    insert into out select 'archive_nodes', count(*)::text from public.team_archive_nodes;
    insert into out select 'terms_rows',    count(*)::text from public.team_terms;
    reset role;
    select * from out;
    rollback;`);
  const p = kv(proj);
  check('no email address anywhere in the published chart', p.has_at === 'false');
  check('no student_id key', p.has_studentid === 'false');
  check('no kkumail key', p.has_kkumail === 'false');
  check('no permission / scope / seat keys', p.has_perms === 'false');
  check('member keys are exactly the allow-list',
    p.keys === 'name,nickname,node_id,photo_focus,photo_url,position', p.keys);
  // RLS on SELECT filters rows silently — a row count is the only honest probe.
  check('anon reads 0 rows from team_archive_members', p.archive_rows === '0');
  check('anon reads 0 rows from team_archive_nodes', p.archive_nodes === '0');
  check('anon reads 0 rows from team_terms', p.terms_rows === '0');

  // ── 3. An unpublished year must not be readable ──────────────────────────
  const draft = await mgmt(`
    begin;
    create temp table out(k text, v text);
    grant all on out to authenticated, anon;
    insert into public.team_terms (year) values (${Y});
    insert into public.team_archive_nodes (year, name) values (${Y}, 'ZZ-LEAK');
    set local role anon;
    select set_config('request.jwt.claims','',true);
    insert into out select 'draft_nodes',
      jsonb_array_length(public.get_public_team_chart(${Y})->'nodes')::text;
    insert into out select 'draft_in_picker',
      (public.get_public_team_years()::text like '%${Y}%')::text;
    reset role;
    select * from out;
    rollback;`);
  const d = kv(draft);
  check('an UNpublished year publishes nothing', d.draft_nodes === '0', d.draft_nodes);
  check('an UNpublished year is not offered in the year picker', d.draft_in_picker === 'false');

  // ── 4. Grant channel, on the NEW tables ─────────────────────────────────
  // UPDATED FOR 0110: `team` was split into `team` (view) and `team_edit`
  // (write), so the key that manages ปีการศึกษา is now `team_edit`. The
  // invariant is unchanged — the tree's grant channel must reach these
  // tables — and the VIEW half is asserted separately below.
  console.log('\nGRANTS');
  const withTeam = await asTreeGrant(`array['team_edit']`, `
    insert into public.team_terms (year, label) values (${Y}, 'ZZ');
    insert into out select 'wrote_term', count(*)::text from public.team_terms where year=${Y};
    insert into out select 'published', (public.publish_team_term(${Y}) is not null)::text;
    insert into out select 'reads_archive', (count(*) > 0)::text
      from public.team_archive_members where year=${Y};`);
  const wt = kv(withTeam);
  check('`team_edit` grantee can create a ปีการศึกษา', wt.wrote_term === '1', JSON.stringify(withTeam.body).slice(0, 200));
  check('`team_edit` grantee can publish a snapshot', wt.published === 'true');
  // 0093's lesson: a channel has two halves. A writer who cannot read back what
  // they wrote has write-only access, which looks like data loss.
  check('`team_edit` grantee can READ the archive back', wt.reads_archive === 'true');

  // 0110's view rung: a plain member (no granted permission at all — the tree
  // posting alone gives them `team`) must SEE the archive and change nothing.
  const viewOnlyRead = await asTreeGrant(`array[]::text[]`, `
    insert into out select 'has_team', public.current_user_has_permission('team')::text;
    insert into out select 'has_edit', public.current_user_has_permission('team_edit')::text;
    insert into out select 'reads_terms', (count(*) >= 0)::text from public.team_terms;`);
  const vo = kv(viewOnlyRead);
  check('a plain member resolves `team` but not `team_edit`',
    vo.has_team === 'true' && vo.has_edit === 'false', JSON.stringify(vo));
  check('…and can READ ปีการศึกษา', vo.reads_terms === 'true', JSON.stringify(vo));

  const viewOnlyWrite = await asTreeGrant(`array[]::text[]`, `
    insert into public.team_terms (year, label) values (${Y}, 'ZZ-VIEWONLY');`);
  check('…but CANNOT create one (the whole point of the split)',
    viewOnlyWrite.status >= 400 && /policy|denied/i.test(JSON.stringify(viewOnlyWrite.body)),
    JSON.stringify(viewOnlyWrite.body).slice(0, 160));

  const withoutTeam = await asTreeGrant(`array['pr','creator']`, `
    insert into public.team_terms (year) values (${Y});`);
  check('other permissions alone cannot write team_terms',
    withoutTeam.status >= 400 && /policy|denied/i.test(JSON.stringify(withoutTeam.body)),
    JSON.stringify(withoutTeam.body).slice(0, 200));

  const rpcNoGrant = await asTreeGrant(`array['pr']`, `
    insert into out select 'published', (public.publish_team_term(${Y}) is not null)::text;`);
  check('publish_team_term refuses a caller without `team_edit`',
    rpcNoGrant.status >= 400 && /not authorized/i.test(JSON.stringify(rpcNoGrant.body)),
    JSON.stringify(rpcNoGrant.body).slice(0, 200));

  // The guard's `coalesce(..., false)`: current_user_role() is NULL for a caller
  // with no public.users row, `null = any(...)` is NULL, and a bare `if not (…)`
  // would evaluate `not null` → null → skip the raise and run the body.
  const nullRole = await mgmt(`
    begin;
    select set_config('request.jwt.claims',
      json_build_object('sub','00000000-0000-0000-0000-000000000000','role','authenticated')::text, true);
    set local role authenticated;
    select public.publish_team_term(${Y});
    rollback;`);
  check('publish_team_term fails CLOSED for a null role (no users row)',
    nullRole.status >= 400 && /not authorized/i.test(JSON.stringify(nullRole.body)),
    JSON.stringify(nullRole.body).slice(0, 200));

  const anonExec = await mgmt(`
    select has_function_privilege('anon','public.publish_team_term(integer,boolean)','execute') as anon_exec,
           has_function_privilege('anon','public.get_public_team_chart(integer)','execute') as anon_chart,
           has_function_privilege('anon','public.get_public_team_years()','execute') as anon_years`);
  const a = anonExec.body?.[0] || {};
  // Functions are granted EXECUTE to PUBLIC by default and revoking from PUBLIC
  // does not drop an explicit anon grant — 0101 found ten resolvers open this way.
  check('anon CANNOT execute publish_team_term', a.anon_exec === false);
  check('anon CAN execute get_public_team_chart', a.anon_chart === true);
  check('anon CAN execute get_public_team_years', a.anon_years === true);

  // ── 5. No public SELECT policy was added to the new tables ───────────────
  const pol = await mgmt(`
    select count(*)::text as n from pg_policies
     where schemaname='public'
       and tablename in ('team_terms','team_archive_nodes','team_archive_members')
       and (coalesce(qual,'') ~ 'true' and coalesce(qual,'') !~ 'current_user')`);
  check('no using(true) policy on any new table', pol.body?.[0]?.n === '0', JSON.stringify(pol.body));


  // ── 6. 0105: every year is a snapshot — the CURRENT year included ────────
  console.log('\n0105 — PUBLISHED SNAPSHOT WINS FOR EVERY YEAR');
  const cur = await mgmt(`
    begin;
    create temp table out(k text, v text);
    grant all on out to authenticated, anon;
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;

    -- before publishing, the current year must still fall back to the live tree
    insert into out select 'before_publish_source', public.get_public_team_chart(null)->>'source';
    select public.publish_team_term((select year from public.team_terms where is_current));
    insert into out select 'after_publish_source',  public.get_public_team_chart(null)->>'source';
    reset role;

    -- an edit to the CURRENT year's archive must be publicly visible…
    update public.team_archive_members set full_name = 'ZZ-0105-EDIT'
     where id = (select id from public.team_archive_members
                  where year = (select year from public.team_terms where is_current) limit 1);
    insert into out select 'archive_edit_public',
      (public.get_public_team_chart(null)::text like '%ZZ-0105-EDIT%')::text;
    -- …and must NOT touch the live tree (the permission engine).
    insert into out select 'live_tree_untouched',
      (not exists (select 1 from public.team_members where full_name='ZZ-0105-EDIT'))::text;

    -- stale detection: snapshot older than the newest live edit
    update public.team_terms set published_at = now() - interval '2 days' where is_current;
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    insert into out select 'stale_when_behind', (
      select e->>'stale' from jsonb_array_elements(public.team_term_status()->'terms') e
       where (e->>'year')::int = (select year from public.team_terms where is_current));
    update public.team_terms set published_at = now() + interval '2 days' where is_current;
    insert into out select 'not_stale_when_ahead', (
      select e->>'stale' from jsonb_array_elements(public.team_term_status()->'terms') e
       where (e->>'year')::int = (select year from public.team_terms where is_current));
    reset role;
    select * from out;
    rollback;`);
  const cv = kv(cur);
  check('unpublished current year still falls back to the LIVE tree',
    cv.before_publish_source === 'live', cv.before_publish_source);
  check('publishing the CURRENT year makes its snapshot the public source',
    cv.after_publish_source === 'archive', cv.after_publish_source);
  check('editing the current year\'s archive IS visible publicly',
    cv.archive_edit_public === 'true');
  check('…and does NOT touch the live tree (the permission engine)',
    cv.live_tree_untouched === 'true');
  check('snapshot older than the live tree flags stale', cv.stale_when_behind === 'true');
  check('snapshot newer than the live tree does not', cv.not_stale_when_ahead === 'false');

  const st = await mgmt(`
    select has_function_privilege('anon','public.team_term_status()','execute') as anon_status,
           has_function_privilege('anon','public.get_public_team_chart(integer)','execute') as anon_chart`);
  const sv = st.body?.[0] || {};
  check('anon CANNOT execute team_term_status', sv.anon_status === false);
  check('anon CAN still execute get_public_team_chart', sv.anon_chart === true);

  const guard = await asTreeGrant(`array['pr']`, `
    insert into out select 'st', (public.team_term_status() is not null)::text;`);
  check('team_term_status refuses a caller without `team_edit`',
    guard.status >= 400 && /not authorized/i.test(JSON.stringify(guard.body)),
    JSON.stringify(guard.body).slice(0, 160));


  // ── 7. 0106: re-publishing must not eat archive-only photos ──────────────
  console.log('\n0106 — RE-PUBLISH KEEPS ARCHIVE-ONLY PHOTOS');
  const rp = await mgmt(`
    begin;
    create temp table out(k text, v text);
    grant all on out to authenticated, anon;
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    select public.publish_team_term(${Y});
    reset role;

    create temp table pick as
      select am.id arc_id, am.src_member_id from public.team_archive_members am
        join public.team_members m on m.id = am.src_member_id
       where am.year=${Y} and m.photo_url is null limit 1;
    update public.team_archive_members
       set photo_url='https://lh3.googleusercontent.com/d/ARCONLY=w2000', photo_focus='top'
     where id=(select arc_id from pick);

    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    insert into out select 'kept', public.publish_team_term(${Y})->>'photos_kept';
    reset role;
    insert into out select 'survived', (exists(select 1 from public.team_archive_members
      where year=${Y} and src_member_id=(select src_member_id from pick)
        and photo_url like '%ARCONLY%' and photo_focus='top'))::text;
    insert into out select 'live_wins', (exists(
      select 1 from public.team_archive_members am join public.team_members m on m.id=am.src_member_id
       where am.year=${Y} and m.photo_url is not null and am.photo_url = m.photo_url))::text;

    update public.team_archive_members set full_name='ZZ-OVERWRITE-ME' where id=(select arc_id from pick);
    select set_config('request.jwt.claims',
      json_build_object('sub',(select id from public.users where role='dev' limit 1),
                        'role','authenticated')::text, true);
    set local role authenticated;
    select public.publish_team_term(${Y});
    reset role;
    insert into out select 'name_overwritten', (not exists(
      select 1 from public.team_archive_members where year=${Y} and full_name='ZZ-OVERWRITE-ME'))::text;
    select * from out;
    rollback;`);
  const rv = kv(rp);
  check('a photo that exists ONLY in the archive survives a re-publish',
    rv.survived === 'true', JSON.stringify(rp.body).slice(0, 200));
  check('publish reports how many photos it carried forward', rv.kept === '1', rv.kept);
  check('a LIVE photo still wins over the archived one', rv.live_wins === 'true');
  check('names ARE overwritten by a re-publish (that is what it means)',
    rv.name_overwritten === 'true');

  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
