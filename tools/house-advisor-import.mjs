// ============================================================
// house-advisor-import.mjs — put the อาจารย์ที่ปรึกษา sheet into ระบบบ้าน:
// the อาจารย์, the สาย each looks after, and their เบอร์โทรศัพท์.
//
// REQUESTED (owner, 2026-10-21). The sheet is ฝ่ายข้อมูล's, one line per
// อาจารย์; src/js/house/advisor-import.js reads it (the ONE parser — this file
// never re-reads a cell itself) and says which lines it refused and why.
//
// ⛔ THE PHONES ARE SENSITIVE. They go to `advisor_phones` (0243), which only a
// house admin can read. This tool prints COUNTS and line numbers, never a name
// or a number, and it refuses a sheet stored inside this repo — the repo is
// public, and a file in the working tree is one `git add .` from GitHub.
//
// WHAT IT DOES, in one transaction:
//   1. creates any สาย the sheet names that does not exist yet (ensure_sais)
//   2. adds each อาจารย์ not already present — matched on the full name, so a
//      re-run updates instead of duplicating
//   3. fills ภาควิชา where the sheet has one
//   4. ADDS the sheet's สาย to each อาจารย์. Never removes one: a สาย someone
//      assigned by hand in the pane stays, and the report counts them
//   5. sets the phone where the sheet has one (a blank leaves the stored one)
//
// ⛔ IT RUNS AS A REAL ADMIN, NOT AS THE SUPERUSER — `set local role
// authenticated` with a house admin's jwt claims, at TOP LEVEL, so RLS and the
// RPC checks are the ones the pane meets (same reason as house-import.mjs).
//
// USAGE
//   node tools/house-advisor-import.mjs <sheet>.csv [--dev]            # DRY RUN, rolls back
//   node tools/house-advisor-import.mjs <sheet>.csv [--dev] --commit   # keeps it
//
// The sheet must be CSV (Excel → Save As → CSV UTF-8). The dry run does the
// real writes and rolls back; what it prints is what committing would leave.
// ============================================================
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/js/team/io.js';
import { parseAdvisorSheet } from '../src/js/house/advisor-import.js';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const wantDev = args.includes('--dev');
const unknown = args.filter((a) => a.startsWith('-') && !['--commit', '--dev'].includes(a));
const file = args.find((a) => !a.startsWith('-'));
if (!file || unknown.length || !/\.csv$/i.test(file)) {
  console.error('usage: node tools/house-advisor-import.mjs <sheet>.csv [--dev] [--commit]'
    + (unknown.length ? `  (unknown: ${unknown.join(' ')})` : ''));
  process.exit(1);
}

const REPO = fileURLToPath(new URL('..', import.meta.url));
const rel = relative(REPO, resolve(file));
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('⛔ the sheet is inside the repo, which is PUBLIC. Move it out (e.g. ~/Downloads) and re-run.');
  process.exit(2);
}

const loaded = loadEnv();
if (wantDev) {
  const url = loaded.env.SUPABASE_DEV_URL;
  const tok = loaded.env.SUPABASE_DEV_ACCESS_TOKEN;
  if (!url || !tok) { console.error('--dev needs SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN'); process.exit(2); }
  loaded.env = { ...loaded.env, VITE_SUPABASE_URL: url, SUPABASE_ACCESS_TOKEN: tok };
}
const target = announceTarget(loaded);
if (wantDev && !target.isDev) { console.error('--dev was asked for but the target is not samo-dev — refusing'); process.exit(2); }

const parsed = parseAdvisorSheet(parseCsv(readFileSync(file, 'utf8')));
if (parsed.fatal) { console.error('⛔ ' + parsed.fatal); process.exit(4); }
const { advisors, problems } = parsed;

console.error(`\n→ ${advisors.length} อาจารย์ · ${advisors.filter((a) => a.phone).length} with a phone`
  + ` · ${advisors.reduce((n, a) => n + a.sai_codes.length, 0)} สาย links`);
if (problems.length) {
  console.error(`→ ${problems.length} line(s) need a person — NOT imported as written:`);
  for (const p of problems) console.error(`    line ${p.line}: ${p.message}`);
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const one = async (sql) => JSON.parse(await runSql(sql, target));

const [actor] = await one(`
  select u.id::text as id, lower(btrim(u.email)) as email
    from public.users u
   where u.email is not null
     and (u.role in ('vp_admin','dev')
          or 'house'  = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}'))
          or 'master' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}')))
   order by (u.role = 'dev') desc, u.id
   limit 1`);
if (!actor) { console.error('no account holds the house grant — nothing may import'); process.exit(3); }

const payload = JSON.stringify(advisors.map(({ lines, ...a }) => a)).replace(/'/g, "''");
const allCodes = [...new Set(advisors.flatMap((a) => a.sai_codes))];

const sql = `
begin;

create temporary table _in on commit drop as
  select x.first_name_th, x.last_name_th, x.dept, x.phone, x.sai_codes,
         btrim(coalesce(x.first_name_th,'') || ' ' || coalesce(x.last_name_th,'')) as full_name
    from jsonb_to_recordset('${payload}'::jsonb)
         as x(first_name_th text, last_name_th text, dept text, phone text, sai_codes jsonb);
grant select on _in to authenticated;

create temporary table _before on commit drop as
  select (select count(*) from public.advisors)      as advisors,
         (select count(*) from public.sai_advisors)  as links,
         (select count(*) from public.advisor_phones) as phones,
         (select count(*) from public.sais)          as sais,
         (select count(*) from _in i where exists (select 1 from public.advisors a where a.full_name = i.full_name)) as matched;

select set_config('request.jwt.claims',
  json_build_object('sub', ${q(actor.id)}, 'role', 'authenticated', 'email', ${q(actor.email)})::text, true);

set local role authenticated;

-- 1. สาย first: sai_advisors.sai_code is a foreign key.
select public.ensure_sais(array[${allCodes.map(q).join(',')}]::text[]);

-- 2. new อาจารย์
insert into public.advisors (first_name_th, last_name_th, dept)
select i.first_name_th, i.last_name_th, i.dept from _in i
 where not exists (select 1 from public.advisors a where a.full_name = i.full_name);

-- 3. ภาควิชา where the sheet has one
update public.advisors a set dept = i.dept, updated_at = now()
  from _in i
 where a.full_name = i.full_name and i.dept is not null and a.dept is distinct from i.dept;

-- 4. ADD the sheet's สาย; position continues after whoever is already there.
insert into public.sai_advisors (sai_code, advisor_id, position)
select w.code, w.advisor_id,
       (select count(*) from public.sai_advisors s where s.sai_code = w.code)
         + row_number() over (partition by w.code order by w.full_name) - 1
  from (select distinct c.code, a.id as advisor_id, a.full_name
          from _in i
          join public.advisors a on a.full_name = i.full_name
          cross join lateral jsonb_array_elements_text(i.sai_codes) as c(code)
         where not exists (select 1 from public.sai_advisors s
                            where s.sai_code = c.code and s.advisor_id = a.id)) w;

-- 5. phones; a blank in the sheet leaves a stored number alone.
insert into public.advisor_phones (advisor_id, phone)
select a.id, i.phone from _in i join public.advisors a on a.full_name = i.full_name
 where i.phone is not null
on conflict (advisor_id) do update set phone = excluded.phone, updated_at = now()
 where public.advisor_phones.phone is distinct from excluded.phone;

reset role;

-- ── what the database looks like from inside the transaction ───────────────
select 'อาจารย์ (before → after)' as what,
       (select advisors from _before) || ' → ' || (select count(*) from public.advisors) as n
union all select 'of the sheet, already present', (select matched from _before)::text
union all select 'สาย links (before → after)',
       (select links from _before) || ' → ' || (select count(*) from public.sai_advisors)
union all select 'phones (before → after)',
       (select phones from _before) || ' → ' || (select count(*) from public.advisor_phones)
union all select 'สาย rows (before → after)',
       (select sais from _before) || ' → ' || (select count(*) from public.sais)
union all select 'sheet อาจารย์ missing after the run', (select count(*)::text from _in i
       where not exists (select 1 from public.advisors a where a.full_name = i.full_name))
union all select 'sheet สาย links missing after the run', (select count(*)::text from _in i
       cross join lateral jsonb_array_elements_text(i.sai_codes) c(code)
       where not exists (select 1 from public.sai_advisors s join public.advisors a on a.id = s.advisor_id
                          where s.sai_code = c.code and a.full_name = i.full_name))
union all select 'sheet phones not stored after the run', (select count(*)::text from _in i
       where i.phone is not null and not exists (select 1 from public.advisor_phones p
         join public.advisors a on a.id = p.advisor_id where a.full_name = i.full_name and p.phone = i.phone))
union all select 'สาย with links NOT from the sheet (kept)', (select count(distinct s.sai_code)::text
       from public.sai_advisors s join public.advisors a on a.id = s.advisor_id
       where not exists (select 1 from _in i where i.full_name = a.full_name))
union all select 'สาย with someone on it and no อาจารย์', (select count(*)::text from public.sais x
       where not exists (select 1 from public.sai_advisors s where s.sai_code = x.code)
         and (exists (select 1 from public.students t where t.sai_code = x.code)
              or exists (select 1 from public.student_import_unresolved h
                          where h.sai_code = x.code and h.resolved_at is null)));

${COMMIT ? 'commit;' : 'rollback;'}
`;

console.error(`→ acting as a house admin · ${COMMIT ? '⚠️  COMMITTING' : 'DRY RUN — this transaction will ROLL BACK'}\n`);
const rows = JSON.parse(await runSql(sql, target));
for (const r of rows) console.log(`  ${String(r.what).padEnd(42)} ${r.n}`);
console.error(COMMIT ? '\n✓ committed.' : '\n✓ rolled back — nothing was kept. Re-run with --commit.');
