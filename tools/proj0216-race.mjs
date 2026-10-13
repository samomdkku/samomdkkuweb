#!/usr/bin/env node
// ============================================================
// proj0216-race.mjs — two people tag the same โครงการ AT THE SAME MOMENT.
//
// The registered proof (proj0212-samo-depts.mjs) is one rolled-back session,
// so it cannot show a race. This runs two PARALLEL transactions against a real
// committed row and deletes it after — so it REFUSES any target but samo-dev.
//   CONTROL: the old whole-array write (read, wait, write) — one tag is lost.
//   FIX:     set_project_samo_dept (0216) — both survive.
// First run 2026-10-13: CONTROL {office}, FIX {academic,office}.
//
//   VITE_SUPABASE_URL="$SUPABASE_DEV_URL" SUPABASE_ACCESS_TOKEN="$SUPABASE_DEV_ACCESS_TOKEN" \
//     node tools/proj0216-race.mjs
// ============================================================
import { announceTarget, runSql } from './env-lib.mjs';
const target = announceTarget();
if (!/samo-dev/.test(JSON.stringify(target))) { console.error('refusing: not samo-dev'); process.exit(2); }
const ID = 'PRJ-RACE-0216';
const asSender = `select set_config('request.jwt.claims', json_build_object('sub', (
  select u.id from public.users u where 'master' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')) order by u.id limit 1
)::text, 'role','authenticated')::text, true); set local role authenticated;`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reset = () => runSql(`delete from public.projects where id='${ID}';
  insert into public.projects (id, name, status, is_public) values ('${ID}', 'race proof (deleted after)', 'open', false);`, target);
const tags = async () => JSON.parse(await runSql(`select samo_depts::text t from public.projects where id='${ID}'`, target))[0].t;

// CONTROL — the old way: each tab READS, waits a moment, writes its whole array.
await reset();
const oldWay = (dept, wait) => runSql(`begin; ${asSender}
  create temporary table seen as select samo_depts from public.projects where id='${ID}';
  select pg_sleep(${wait});
  select public.set_project_samo_depts('${ID}', (select samo_depts from seen) || array['${dept}']);
  commit;`, target);
await Promise.all([oldWay('office', 2), (async () => { await sleep(500); await oldWay('academic', 0); })()]);
console.log('CONTROL (old whole-array write):', await tags(), '← one tag lost means the race is real');

// THE FIX — one change each; A holds its lock for 2 s while B arrives.
await reset();
const newWay = (dept, wait) => runSql(`begin; ${asSender}
  select public.set_project_samo_dept('${ID}', '${dept}', true);
  select pg_sleep(${wait});
  commit;`, target);
await Promise.all([newWay('office', 2), (async () => { await sleep(500); await newWay('academic', 0); })()]);
const after = await tags();
console.log('FIX (set_project_samo_dept):    ', after);
await runSql(`delete from public.projects where id='${ID}'`, target);
console.log(after === '{academic,office}' ? 'PASS both tags survived' : 'FAIL a tag was lost');
process.exit(after === '{academic,office}' ? 0 : 1);
