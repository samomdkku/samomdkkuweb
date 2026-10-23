#!/usr/bin/env node
// ============================================================
// row-cap-probe.mjs — PostgREST's row cap, measured against the REAL server,
// both directions.
//
// The bug (2026-10-23, "samopassport points got freeze"): one PostgREST read
// returns at most `max-rows` rows and reports the cut only in Content-Range,
// so the Passport leaderboards saw 1,000 of 1,352 scans. The unit test
// (src/js/row-cap.test.js) proves the wrapper against a STUB; this proves the
// stub's assumptions still describe the deployment:
//
//   1. CONTROL — a raw read of passport.scans really IS cut short (if this
//      ever passes whole, the cap moved and the stub needs re-measuring).
//   2. the same read through pagedFetch comes back WHOLE (= the exact count).
//   3. no row is duplicated or missing across the page seam.
//   4. a bounded read (limit=5) is left exactly as asked.
//
// Read-only; uses the public key, the same one the browser bundle carries.
//   node tools/row-cap-probe.mjs            (production)
//   VITE_SUPABASE_URL=$SUPABASE_DEV_URL node tools/row-cap-probe.mjs
// ============================================================
import { loadEnv, resolveTarget } from './env-lib.mjs';
import { pagedFetch, ROW_CAP } from '../src/js/rest-pages.js';

const loaded = loadEnv();
const target = resolveTarget(loaded);
const env = loaded.env;
const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const isDev = env.SUPABASE_DEV_URL && url === env.SUPABASE_DEV_URL.replace(/\/$/, '');
const key = isDev ? env.SUPABASE_DEV_ANON_KEY : env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('need VITE_SUPABASE_URL + its public key'); process.exit(1); }
console.error(`→ project: ${target.ref}  (${target.label})`);

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'passport' };
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const countRes = await fetch(`${url}/rest/v1/scans?select=id`, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact' } });
const total = Number((countRes.headers.get('content-range') || '').split('/')[1]);
check('the subject table is bigger than the cap (else nothing below can fail)', total > ROW_CAP, `${total} scans, cap ${ROW_CAP}`);

const path = `${url}/rest/v1/scans?select=id&order=id.asc`;
const raw = await (await fetch(path, { headers: H })).json();
check('CONTROL: a raw read is cut at the cap', raw.length === Math.min(total, ROW_CAP), `${raw.length} rows`);

const viaWrapper = await (await pagedFetch(fetch)(path, { headers: H })).json();
check('through pagedFetch the read is WHOLE', viaWrapper.length === total, `${viaWrapper.length} of ${total}`);
const ids = viaWrapper.map((r) => r.id);
check('no row duplicated across the page seam', new Set(ids).size === ids.length);
check('rows stay in the order asked for', ids.every((v, i) => i === 0 || ids[i - 1] < v));

const bounded = await (await pagedFetch(fetch)(`${path}&limit=5`, { headers: H })).json();
check('a bounded read is left as asked', bounded.length === 5, `${bounded.length} rows`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed} passed, ${results.length - passed} failed`);
