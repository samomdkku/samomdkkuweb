// ============================================================
// safeupdate.test.js — no function may run a DELETE or UPDATE without WHERE.
//
// Every request from the site reaches Postgres through PostgREST, whose
// `authenticator` role preloads the `safeupdate` library. It refuses a DELETE
// or UPDATE with no WHERE clause — "DELETE requires a WHERE clause" — and it
// applies INSIDE functions, SECURITY DEFINER or not, and inside the trigger
// functions a site write fires. publish_team_term's bare
// `delete from _pub_photos;` broke "เผยแพร่ปีนี้" from 0104 (2026-07-30) until
// 0225, and the year handover with it.
//
// No proof can see this: proofs run through the Management API, where
// safeupdate is not loaded. So this reads the SOURCE — the NEWEST definition
// of every function across supabase/migrations — and fails on the shape.
// Write `where true` when you really mean every row (a scratch temp table).
// `insert … on conflict … do update set` is not an UPDATE statement and is
// exempt.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const FILES = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

/** name → { file, body } for the LAST migration that (re)defines it. */
function newestBodies() {
  const out = new Map();
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_][\w.]*)\s*\([\s\S]*?\bas\s+(\$[a-z_]*\$)([\s\S]*?)\2/gi;
  for (const f of FILES) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    for (const m of sql.matchAll(re)) {
      const name = m[1].toLowerCase().includes('.') ? m[1].toLowerCase() : `public.${m[1].toLowerCase()}`;
      out.set(name, { file: f, body: m[3] });
    }
  }
  return out;
}

/** The DELETE/UPDATE statements in `body` that carry no WHERE. */
export function whereLess(body) {
  const code = body.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
  const bad = [];
  for (const stmt of code.split(';')) {
    const s = stmt.replace(/\s+/g, ' ').trim();
    const del = s.match(/(?:^|\s)(delete\s+from\s[\s\S]*)$/i);
    const upd = s.match(/(?:^|\s|\bthen\s|\belse\s)(update\s+[\w."]+(?:\s+(?:as\s+)?\w+)?\s+set\s[\s\S]*)$/i);
    const hit = del?.[1] || (upd && !/\bdo\s+update\s+set\b/i.test(s) ? upd[1] : null);
    if (hit && !/\bwhere\b/i.test(hit)) bad.push(hit.slice(0, 90));
  }
  return bad;
}

describe('safeupdate: no WHERE-less DELETE/UPDATE in any function body', () => {
  const bodies = newestBodies();

  it('found the functions (a sweep that finds nothing must prove it looked)', () => {
    expect(bodies.size).toBeGreaterThan(100);
    expect(bodies.has('public.publish_team_term')).toBe(true);
  });

  it('the detector catches the bug it exists for, and passes its fix', () => {
    expect(whereLess('begin delete from _pub_photos; end')).toHaveLength(1);
    expect(whereLess('begin delete from _pub_photos where true; end')).toEqual([]);
    expect(whereLess('begin update t set a = 1; end')).toHaveLength(1);
    expect(whereLess('insert into t values (1) on conflict (id) do update set a = excluded.a;')).toEqual([]);
  });

  it('every function\'s newest body is safe', () => {
    const bad = [];
    for (const [name, { file, body }] of bodies) {
      for (const s of whereLess(body)) bad.push(`${name} (${file}): ${s}`);
    }
    expect(bad, 'Add a WHERE (`where true` for a scratch table) — see this file\'s header.').toEqual([]);
  });
});
