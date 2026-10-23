// ============================================================
// row-cap.test.js — no read is silently cut at PostgREST's 1,000-row cap.
//
// REPORTED 2026-10-23: "samopassport points got freeze, also on the
// leaderboard". Both Passport leaderboards read passport.scans in one request;
// PostgREST answered 1,000 of 1,352 rows with a 200 and `Content-Range:
// 0-999/*`, so every scan past the cut was invisible. The shop and ระบบบ้าน had
// each been fixed AT THEIR OWN CALL SITE before; nothing carried the rule to the
// next table, and nothing here could have noticed — no test ever fed a reader
// more rows than the cap.
//
// This feeds a stub that behaves like PostgREST (a hard cap, Range and
// limit/offset honoured, Content-Range on every answer) a table bigger than the
// cap, and asserts what comes OUT, not how the code is shaped. Then it checks
// every client in both apps is built with the wrapper — a wrapper nobody uses
// is a comment.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pagedFetch, fetchAllPages, parseContentRange, ROW_CAP } from './rest-pages.js';
import { stripComments } from './strip-comments.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const BASE = 'https://proj.supabase.co/rest/v1';

/** A PostgREST stand-in. `rows` is the table; `cap` is max-rows. Counts calls
 *  by method so a test can assert an RPC was NOT re-run. */
function fakePostgrest(total, { cap = ROW_CAP, ignoreRange = false } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url: url.toString(), headers: { ...(init.headers || {}) } });
    let from = 0;
    let to = Infinity;
    if (url.searchParams.has('offset')) from = Number(url.searchParams.get('offset'));
    if (url.searchParams.has('limit')) to = from + Number(url.searchParams.get('limit')) - 1;
    const rangeHeader = Object.entries(init.headers || {}).find(([k]) => k.toLowerCase() === 'range')?.[1];
    if (rangeHeader && !ignoreRange) {
      const [a, b] = rangeHeader.split('-').map(Number);
      from = a; to = b;
    }
    to = Math.min(to, from + cap - 1, rows.length - 1);
    if (from > 0 && from >= rows.length) {
      return new Response('{"code":"PGRST103"}', { status: 416, headers: { 'content-range': `*/${rows.length}` } });
    }
    const slice = rows.slice(from, to + 1);
    return new Response(JSON.stringify(slice), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': slice.length ? `${from}-${to}/*` : '*/*' },
    });
  };
  return { fetchImpl, calls, rows };
}

afterEach(() => vi.restoreAllMocks());

describe('parseContentRange', () => {
  it('reads the three shapes PostgREST sends', () => {
    expect(parseContentRange('0-999/*')).toEqual({ start: 0, end: 999, total: null });
    expect(parseContentRange('0-999/1352')).toEqual({ start: 0, end: 999, total: 1352 });
    expect(parseContentRange('*/*')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('pagedFetch — a GET bigger than the cap', () => {
  it('CONTROL: the raw stub really truncates (else every assertion below is vacuous)', async () => {
    const { fetchImpl } = fakePostgrest(1352);
    const res = await fetchImpl(`${BASE}/scans?select=id&order=id.asc`);
    expect((await res.json()).length).toBe(1000);
    expect(res.headers.get('content-range')).toBe('0-999/*');
  });

  it('returns EVERY row, in order, with no duplicate — the 1,352-scan leaderboard', async () => {
    const { fetchImpl, calls } = fakePostgrest(1352);
    const res = await pagedFetch(fetchImpl)(`${BASE}/scans?select=id&order=id.asc`);
    const got = await res.json();
    expect(got.length).toBe(1352);
    expect(new Set(got.map((r) => r.id)).size).toBe(1352);
    expect(got[1351].id).toBe(1352);
    expect(calls.length).toBe(2);
    expect(res.headers.get('content-range')).toBe('0-1351/*');
  });

  it('an exact multiple of the cap ends on the 416, not with an error', async () => {
    const { fetchImpl } = fakePostgrest(2000);
    const res = await pagedFetch(fetchImpl)(`${BASE}/scans?select=id&order=id.asc`);
    expect(res.ok).toBe(true);
    expect((await res.json()).length).toBe(2000);
  });

  it('a read under the cap is one request, untouched', async () => {
    const { fetchImpl, calls } = fakePostgrest(701);
    const res = await pagedFetch(fetchImpl)(`${BASE}/profiles?select=id`);
    expect((await res.json()).length).toBe(701);
    expect(calls.length).toBe(1);
  });

  it('an UNORDERED read still comes back whole, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchImpl } = fakePostgrest(1500);
    const res = await pagedFetch(fetchImpl)(`${BASE}/unordered_table?select=id`);
    expect((await res.json()).length).toBe(1500);
    expect(warn.mock.calls.some(([m]) => String(m).includes('[ROW-CAP]'))).toBe(true);
  });

  it('a caller that set its own limit / Range keeps exactly what it asked for', async () => {
    const { fetchImpl, calls } = fakePostgrest(5000);
    const wrapped = pagedFetch(fetchImpl);
    expect((await (await wrapped(`${BASE}/t?select=id&order=id.asc&limit=1000`)).json()).length).toBe(1000);
    expect((await (await wrapped(`${BASE}/t?select=id&order=id.asc`, { headers: { Range: '0-999' } })).json()).length).toBe(1000);
    expect(calls.length).toBe(2);
  });

  it('a server that ignores Range cannot loop it for ever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchImpl, calls } = fakePostgrest(5000, { ignoreRange: true });
    await pagedFetch(fetchImpl)(`${BASE}/t?select=id&order=id.asc`);
    expect(calls.length).toBeLessThan(5);
  });
});

describe('pagedFetch — an RPC is never re-run', () => {
  it('a POST /rpc/ at the cap is reported, not repeated (it may write)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fetchImpl, calls } = fakePostgrest(1500);
    const res = await pagedFetch(fetchImpl)(`${BASE}/rpc/leaderboard_names`, { method: 'POST', body: '{}' });
    expect((await res.json()).length).toBe(1000);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    expect(err.mock.calls.some(([m]) => String(m).includes('[ROW-CAP]'))).toBe(true);
  });
});

describe('fetchAllPages — the explicit pager for read RPCs', () => {
  it('collects every page of a set bigger than the cap', async () => {
    const { fetchImpl } = fakePostgrest(2345);
    const page = async (from, to) => {
      const r = await fetchImpl(`${BASE}/rpc/admin_leaderboard?order=user_id.asc&offset=${from}&limit=${to - from + 1}`, { method: 'POST' });
      return r.ok ? { data: await r.json(), error: null } : { data: null, error: { status: r.status } };
    };
    const { data, error } = await fetchAllPages(page);
    expect(error).toBeNull();
    expect(data.length).toBe(2345);
    expect(new Set(data.map((r) => r.id)).size).toBe(2345);
  });

  it('a failed page fails the read — never a silently short list', async () => {
    let n = 0;
    const { data, error } = await fetchAllPages(async () => (++n === 2
      ? { data: null, error: { message: 'boom', status: 500 } }
      : { data: Array.from({ length: ROW_CAP }, (_, i) => ({ i })), error: null }));
    expect(data).toBeNull();
    expect(error.message).toBe('boom');
  });
});

describe('every PostgREST client is built with the wrapper', () => {
  const src = (p) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

  it('samoweb: the db client AND dbRest go through restFetch', () => {
    const s = src('src/js/db.js');
    expect(s).toMatch(/const restFetch = pagedFetch\(/);
    expect(s).toMatch(/global:\s*\{\s*fetch:\s*restFetch\s*\}/);
    expect(s).toMatch(/await restFetch\(`\$\{url\}\/rest\/v1\$\{path\}`/);
    // and no raw fetch() to PostgREST is left beside it
    expect(s.match(/await fetch\(`\$\{url\}\/rest\/v1/g)).toBeNull();
  });

  it('passport: BOTH clients (Google + the legacy admin door)', () => {
    const s = src('passport/js/app.js');
    const clients = s.match(/createClient\(/g) || [];
    const wired = s.match(/global:\s*\{\s*fetch:\s*restFetch\s*\}/g) || [];
    expect(clients.length).toBeGreaterThan(0);
    expect(wired.length).toBe(clients.length);
  });

  it('no other module creates a supabase client that would skip it', () => {
    const files = ['src/js', 'passport/js'].flatMap((d) => listJs(join(ROOT, d)));
    const offenders = files
      .filter((f) => !/\.test\.js$/.test(f))
      .filter((f) => /createClient\(/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => f.replace(ROOT, ''))
      .filter((f) => f !== 'src/js/db.js' && f !== 'passport/js/app.js');
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(50);   // the sweep looked somewhere
  });

  it('both Passport leaderboards page their RPC (the transport will not)', () => {
    const dash = src('passport/js/dashboard.js');
    const admin = src('passport/js/admin-page.js');
    expect(dash).toMatch(/fetchAllPages\(\(from, to\) => supabase\.rpc\('leaderboard_names'\)/);
    expect(admin).toMatch(/fetchAllPages\(\(from, to\) => adminDb\.rpc\('admin_leaderboard'\)/);
    expect(dash).not.toMatch(/supabase\.rpc\('leaderboard_names'\)(?!\s*\.order)/);
  });
});


function listJs(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listJs(p) : (p.endsWith('.js') ? [p] : []);
  });
}
