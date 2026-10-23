// ==============================================
// rest-pages.js — PostgREST's 1,000-row cap, handled at the TRANSPORT.
//
// REPORTED 2026-10-23: "samopassport points got freeze, also on the
// leaderboard". PostgREST answers any read with at most `max-rows` rows (1,000
// on this project) and says so only in a header — `Content-Range: 0-999/*` —
// with a 200 and a perfectly good JSON array. Both Passport leaderboards read
// `passport.scans` in ONE request; at 1,352 scans the newest 352 never reached
// the browser, so a new scan stopped moving anybody's rank. Each student's own
// passport read only their own scans and was right the whole time, which is
// why it looked like the LEADERBOARD froze rather than the points.
//
// The shop had already paid for this (`listAllOrders`, shop/api.js) and
// ระบบบ้าน for its roster (`fetchStudents`) — each fixed AT ITS OWN CALL SITE,
// so the next table to cross 1,000 rows was unprotected by construction. This
// file is the rule held once, where every response passes:
//
//   * a GET whose answer is exactly the cap, from a caller that did not ask for
//     a bound of its own, is FETCHED IN FULL — page after page, same request
//     plus a Range header, concatenated into one response. The caller sees the
//     whole table and cannot tell. (An unordered request still pages — better
//     than truncating — but is reported, because Postgres only promises a
//     stable row order when the query states one.)
//   * a POST to /rpc/ is NEVER repeated: an RPC can write, and paging would run
//     it again per page. Hitting the cap there is reported loudly instead; a
//     read RPC that can grow pages itself with `fetchAllPages` below.
//   * anything that set its own `limit=`, `offset=` or Range is the caller's
//     business and passes through untouched.
//
// Where it is wired: src/js/db.js (the `db` client AND dbRest), passport/js/
// app.js (both clients). `row-cap.test.js` asserts the behaviour against a stub
// PostgREST and that every client is built with it.
// ==============================================

/** PostgREST `max-rows` on this project (measured: `content-range: 0-999/1352`
 *  for a 1,352-row table, 2026-10-23). A smaller cap than this is still
 *  detected — the test is "a page came back full", not "1,000 came back". */
export const ROW_CAP = 1000;

const SAYS = {
  rpc: 'an RPC returned a full page and was NOT re-run (it may write) — page it with fetchAllPages:',
  unordered: 'paged an UNORDERED read — add order= so the pages cannot overlap:',
  runaway: 'stopped paging at 200 pages — this read is far too big for a browser:',
  'range-ignored': 'the server ignored the Range header, so the read is INCOMPLETE:',
};
const warned = new Set();
function report(kind, path) {
  const key = `${kind} ${path}`;
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console[kind === 'unordered' ? 'warn' : 'error'](`[ROW-CAP] ${SAYS[kind]} ${path}`);
}

/** "0-999/*" → { start: 0, end: 999, total: null }; "*\/0" or junk → null. */
export function parseContentRange(h) {
  const m = /^(\d+)-(\d+)\/(\d+|\*)$/.exec(String(h || '').trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) };
}

function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => String(k).toLowerCase() === name.toLowerCase());
    return hit ? hit[1] : null;
  }
  const k = Object.keys(headers).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : null;
}

function toPlainHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    headers.forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(headers)) {
    headers.forEach(([k, v]) => { out[k] = v; });
  } else {
    Object.assign(out, headers);
  }
  return out;
}

/**
 * Wrap a fetch so a PostgREST read can never be silently cut at the cap.
 * `baseFetch` is called with exactly what the caller passed for the first
 * page; follow-up pages add `Range`/`Range-Unit` and nothing else.
 */
export function pagedFetch(baseFetch, { cap = ROW_CAP } = {}) {
  return async function fetchAllRows(input, init = {}) {
    const res = await baseFetch(input, init);
    try {
      const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
      if (!urlStr.includes('/rest/v1/') || !res || (res.status !== 200 && res.status !== 206)) return res;
      const range = parseContentRange(res.headers && res.headers.get && res.headers.get('content-range'));
      if (!range) return res;
      const n = range.end - range.start + 1;
      if (n < cap) return res;
      if (range.total != null && range.end + 1 >= range.total) return res;   // full page that IS the end

      const u = new URL(urlStr, 'http://x');
      const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
      const reqHeaders = init.headers || (input && input.headers);
      const callerBounded = u.searchParams.has('limit') || u.searchParams.has('offset')
        || headerOf(reqHeaders, 'range') != null;
      if (callerBounded) return res;
      const path = u.pathname.replace(/^.*\/rest\/v1/, '');
      if (method !== 'GET' && method !== 'HEAD') {
        if (path.startsWith('/rpc/')) report('rpc', path);
        return res;
      }
      if (method === 'HEAD') return res;
      const accept = String(headerOf(reqHeaders, 'accept') || '');
      if (accept && !/json/i.test(accept)) return res;          // csv, single object: not ours
      if (!u.searchParams.has('order')) report('unordered', path);

      const rows = await res.clone().json();
      if (!Array.isArray(rows)) return res;
      const all = rows.slice();
      for (let from = range.start + n, pages = 1; ; from += cap, pages += 1) {
        // 200 pages = 200,000 rows: no browser read here is meant to be that
        // big, so stop and say so rather than hang the tab.
        if (pages >= 200) { report('runaway', path); break; }
        const page = await baseFetch(input, {
          ...init,
          headers: { ...toPlainHeaders(reqHeaders), Range: `${from}-${from + cap - 1}`, 'Range-Unit': 'items' },
        });
        if (page.status === 416) break;                          // asked past the last row
        if (!page.ok) return page;                               // a failed page fails the read, never truncates it
        // A server that ignored the Range would hand back page one for ever.
        const got = parseContentRange(page.headers && page.headers.get && page.headers.get('content-range'));
        if (got && got.start !== from) { report('range-ignored', path); break; }
        const more = await page.json();
        if (!Array.isArray(more)) return page;
        all.push(...more);
        if (more.length < cap) break;
      }
      const headers = toPlainHeaders(res.headers);
      delete headers['content-length'];
      headers['content-range'] = `${range.start}-${range.start + all.length - 1}/${range.total ?? '*'}`;
      return new Response(JSON.stringify(all), { status: 200, statusText: 'OK', headers });
    } catch {
      return res;                                                // the wrapper must never cost a read
    }
  };
}

/**
 * Explicit paging for a read whose request this file must not repeat on its
 * own — a read RPC that returns a set (leaderboard_names, admin_leaderboard).
 * `fetchPage(from, to)` returns `{ data, error }` (a supabase-js builder with
 * `.range(from, to)` already does). The query MUST order by a unique key, or
 * two pages can share a row.
 */
export async function fetchAllPages(fetchPage, { page = ROW_CAP } = {}) {
  const out = [];
  for (let from = 0, pages = 0; pages < 200; from += page, pages += 1) {
    const { data, error } = await fetchPage(from, from + page - 1);
    if (error) {
      if (error.status === 416 || error.code === 'PGRST103') break;   // past the last row
      return { data: null, error };
    }
    const rows = data || [];
    out.push(...rows);
    // More rows than asked for means the bound was not applied at all, so the
    // next "page" would be this one again — stop, the read is already whole.
    if (rows.length < page || rows.length > page) break;
  }
  return { data: out, error: null };
}
