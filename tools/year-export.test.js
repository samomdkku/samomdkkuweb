import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  REGISTRY, csvCell, rowsToCsv, csvColumnsFor, yearWhereClause,
  archiveFolderPath, archiveFileName, buildGasUploadPayload, buildPlan,
  planLines, fetchExport, columnExists,
} from './year-export.mjs';

describe('REGISTRY mirrors the SAME nested shape the app itself reads (class 6 guard)', () => {
  // shop/api.js and projects/api.js each build their admin fetch from a
  // named `*_FIELDS` constant that is '*' plus a nested PostgREST select.
  // If either changes, this test must fail — a silent drift here means the
  // export stops matching what the dashboard actually shows an admin.
  const shopApi = readFileSync(new URL('../src/js/shop/api.js', import.meta.url), 'utf8');
  const projectsApi = readFileSync(new URL('../src/js/projects/api.js', import.meta.url), 'utf8');

  it('shop_orders nests exactly the child table ORDER_FIELDS names', () => {
    const m = shopApi.match(/const ORDER_FIELDS = '([^']+)'/);
    expect(m, 'ORDER_FIELDS not found in shop/api.js — update the grep, not the registry blindly').toBeTruthy();
    expect(m[1]).toContain('items:shop_order_items(*)');
    expect(REGISTRY.shop_orders.children.map((c) => c.table)).toEqual(['shop_order_items']);
  });

  it('projects nests project_documents, which nests project_sign_requests, exactly like PROJECT_FIELDS', () => {
    const m = projectsApi.match(/const PROJECT_FIELDS = '([^']+)'/);
    expect(m, 'PROJECT_FIELDS not found in projects/api.js — update the grep, not the registry blindly').toBeTruthy();
    expect(m[1]).toContain('documents:project_documents(*,sign_requests:project_sign_requests(*))');
    expect(REGISTRY.projects.children.map((c) => c.table)).toEqual(['project_documents']);
    expect(REGISTRY.projects.children[0].children.map((c) => c.table)).toEqual(['project_sign_requests']);
  });

  it('every registered table has an idColumn and a year source (stored column and/or timestamp)', () => {
    for (const [key, entry] of Object.entries(REGISTRY)) {
      expect(entry.idColumn, key).toBeTruthy();
      expect(entry.yearColumn || entry.timestampColumn, key).toBeTruthy();
    }
  });
});

describe('yearWhereClause', () => {
  it('prefers the stored column when it exists', () => {
    expect(yearWhereClause(REGISTRY.pr_tickets, 2569, true)).toBe('samo_year_be = 2569');
  });

  it('derives from the timestamp column via samo_year_for_timestamp() when it does not', () => {
    expect(yearWhereClause(REGISTRY.vs_tickets, 2569, false))
      .toBe('public.samo_year_for_timestamp(timestamp) = 2569');
  });

  it('throws rather than silently matching everything on a bad year', () => {
    expect(() => yearWhereClause(REGISTRY.pr_tickets, 'not-a-year', true)).toThrow();
  });

  it('throws if there is neither a stored column nor a timestamp to derive from', () => {
    const entry = { table: 'x', yearColumn: 'samo_year_be', timestampColumn: null };
    expect(() => yearWhereClause(entry, 2569, false)).toThrow();
  });
});

describe('csvCell / rowsToCsv — the formula guard and quoting', () => {
  it('guards a formula-shaped value (csvGuard) and still quotes it', () => {
    expect(csvCell('=HYPERLINK(1)')).toBe('"\'=HYPERLINK(1)"');
  });

  it('null becomes an empty quoted cell, never the literal string "null"', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('escapes embedded quotes RFC4180-style', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('a plain number is never formula-guarded', () => {
    expect(csvCell(-1)).toBe('"-1"');
  });

  it('rowsToCsv opens with a UTF-8 BOM and CRLF row separators', () => {
    const out = rowsToCsv([{ a: 1, b: 'x' }], ['a', 'b']);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('\r\n');
    expect(out).toBe('﻿"a","b"\r\n"1","x"');
  });
});

describe('csvColumnsFor', () => {
  it('unions keys across rows so a row missing an optional key does not shift columns', () => {
    const cols = csvColumnsFor([{ a: 1, b: 2 }, { a: 1, c: 3 }]);
    expect(cols).toEqual(['a', 'b', 'c']);
  });

  it('drops a nested array-of-objects column (a PostgREST child relation) — it gets its OWN csv file', () => {
    const cols = csvColumnsFor([{ id: 1, items: [{ x: 1 }] }]);
    expect(cols).toEqual(['id']);
  });

  it('keeps a plain array column (not a nested relation)', () => {
    const cols = csvColumnsFor([{ id: 1, tags: ['a', 'b'] }]);
    expect(cols).toEqual(['id', 'tags']);
  });
});

describe('the Drive destination — stubbed, asserting what would be SENT', () => {
  it('archiveFolderPath / archiveFileName never nest inside another system\'s live folder', () => {
    expect(archiveFolderPath(2569)).toBe('Archives/2569');
    expect(archiveFileName('pr_tickets', 2569, 'csv')).toBe('pr_tickets_2569.csv');
  });

  it('buildGasUploadPayload sends exactly the shape handleUploadArchiveFile expects, nothing more', () => {
    const payload = buildGasUploadPayload({
      system: 'pr_tickets', year: 2569, fileName: 'pr_tickets_2569.json',
      mimeType: 'application/json', fileData: 'data:application/json;base64,AAA=',
    });
    expect(payload).toEqual({
      action: 'uploadArchiveFile',
      folderPath: 'Archives/2569',
      fileName: 'pr_tickets_2569.json',
      mimeType: 'application/json',
      fileData: 'data:application/json;base64,AAA=',
    });
  });
});

describe('buildPlan / planLines — never carry a row value, only counts and paths', () => {
  it('a plan built from counts contains no row content anywhere in its printed lines', () => {
    const plan = buildPlan({
      system: 'vs_tickets', year: 2569, baseCount: 3,
      childCounts: { vs_public_comments: 2 },
    });
    const lines = planLines(plan, './exports', false).join('\n');
    // A sentinel that would ONLY appear if a row's actual field value leaked
    // into a printed line — it must never be constructible from counts alone.
    expect(lines).not.toMatch(/สมชาย|@kkumail|problem|ปัญหา/);
    expect(lines).toContain('vs_tickets / 2569: 3 row(s)');
    expect(lines).toContain('vs_public_comments');
  });

  it('plan file paths are namespaced by system and year, so two exports never collide on disk', () => {
    const plan = buildPlan({ system: 'shop_orders', year: 2568, baseCount: 1, childCounts: {} });
    expect(plan.files[0].path).toBe('shop_orders/2568/shop_orders_2568.json');
    expect(plan.files[1].path).toBe('shop_orders/2568/shop_orders_2568.csv');
  });
});

describe('fetchExport — stubbed DB, asserting the exact SQL sent (not the result)', () => {
  it('prefers the stored column, and fetches children keyed by the PARENT\'s ids', async () => {
    const calls = [];
    const runSqlFn = vi.fn(async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) return JSON.stringify([{ e: true }]);
      if (sql.startsWith('select * from public.shop_orders')) {
        return JSON.stringify([{ id: 'ORD-1' }, { id: 'ORD-2' }]);
      }
      if (sql.startsWith('select * from public.shop_order_items')) {
        return JSON.stringify([{ id: 'ITEM-1', order_id: 'ORD-1' }]);
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const { base, children } = await fetchExport(REGISTRY.shop_orders, 2569, { runSqlFn, target: { ref: 'stub' } });

    expect(base).toEqual([{ id: 'ORD-1' }, { id: 'ORD-2' }]);
    expect(children.shop_order_items).toEqual([{ id: 'ITEM-1', order_id: 'ORD-1' }]);

    const baseQuery = calls.find((s) => s.startsWith('select * from public.shop_orders'));
    expect(baseQuery).toBe('select * from public.shop_orders where samo_year_be = 2569');

    const childQuery = calls.find((s) => s.startsWith('select * from public.shop_order_items'));
    expect(childQuery).toBe("select * from public.shop_order_items where order_id in ('ORD-1','ORD-2')");
  });

  it('falls back to deriving the year from the timestamp when the stored column does not exist yet', async () => {
    const calls = [];
    const runSqlFn = vi.fn(async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) return JSON.stringify([{ e: false }]);
      return JSON.stringify([]);
    });

    await fetchExport(REGISTRY.vs_tickets, 2569, { runSqlFn, target: { ref: 'stub' } });

    const baseQuery = calls.find((s) => s.startsWith('select * from public.vs_tickets'));
    expect(baseQuery).toBe('select * from public.vs_tickets where public.samo_year_for_timestamp(timestamp) = 2569');
  });

  it('a grandchild (project_sign_requests) is fetched against the DOCUMENT ids, never the top-level project ids', async () => {
    const calls = [];
    const runSqlFn = vi.fn(async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) return JSON.stringify([{ e: true }]);
      if (sql.startsWith('select * from public.projects')) return JSON.stringify([{ id: 'PRJ-1' }]);
      if (sql.startsWith('select * from public.project_documents')) return JSON.stringify([{ id: 'DOC-1', project_id: 'PRJ-1' }]);
      if (sql.startsWith('select * from public.project_sign_requests')) return JSON.stringify([{ id: 'SIG-1', document_id: 'DOC-1' }]);
      throw new Error(`unexpected query: ${sql}`);
    });

    const { children } = await fetchExport(REGISTRY.projects, 2569, { runSqlFn, target: { ref: 'stub' } });

    expect(children.project_sign_requests).toEqual([{ id: 'SIG-1', document_id: 'DOC-1' }]);
    const sigQuery = calls.find((s) => s.startsWith('select * from public.project_sign_requests'));
    // Must key off DOC-1 (the document id), never PRJ-1 (the project id) —
    // a query keyed on the wrong id would silently return zero rows forever.
    expect(sigQuery).toBe("select * from public.project_sign_requests where document_id in ('DOC-1')");
  });

  it('a child fetch with zero parent rows sends NO query at all (never `in ()`, which is a SQL error)', async () => {
    const calls = [];
    const runSqlFn = vi.fn(async (sql) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) return JSON.stringify([{ e: true }]);
      return JSON.stringify([]);
    });

    const { children } = await fetchExport(REGISTRY.shop_orders, 2569, { runSqlFn, target: { ref: 'stub' } });
    expect(children.shop_order_items).toEqual([]);
    expect(calls.some((s) => s.includes('shop_order_items'))).toBe(false);
  });
});

describe('columnExists — stubbed DB', () => {
  it('asks information_schema.columns for the EXACT table/column pair, nothing broader', async () => {
    const runSqlFn = vi.fn(async (sql) => {
      expect(sql).toContain("table_name = 'pr_tickets'");
      expect(sql).toContain("column_name = 'samo_year_be'");
      return JSON.stringify([{ e: true }]);
    });
    const got = await columnExists('pr_tickets', 'samo_year_be', { ref: 'stub' }, runSqlFn);
    expect(got).toBe(true);
  });
});
