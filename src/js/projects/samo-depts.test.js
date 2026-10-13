// ==============================================
// samo-depts.test.js — ฝ่ายสโม tags: the filter logic, and the ratchet that
// keeps the SQL allow-list and VS_DEPTS from drifting apart (mistakes
// class 6 — a second taxonomy, or a correct one that silently rots).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SAMO_DEPT_VALUES,
  projectSamoDepts,
  projectMatchesSamoDepts,
  samoDeptLabel,
} from './samo-depts.js';
import { VS_DEPTS } from '../team-vocab.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('projectSamoDepts — normalising the stored column', () => {
  it('returns [] for a missing/null/non-array value', () => {
    expect(projectSamoDepts({})).toEqual([]);
    expect(projectSamoDepts({ samo_depts: null })).toEqual([]);
    expect(projectSamoDepts({ samo_depts: 'not-an-array' })).toEqual([]);
    expect(projectSamoDepts(null)).toEqual([]);
  });

  it('passes through a real tag list, dropping falsy entries', () => {
    expect(projectSamoDepts({ samo_depts: ['SE', '', null, 'นายกสโม'] }))
      .toEqual(['SE', 'นายกสโม']);
  });
});

describe('projectMatchesSamoDepts — the filter', () => {
  const untagged = { id: 'P1', samo_depts: [] };
  const oneTag   = { id: 'P2', samo_depts: ['SE'] };
  const twoTags  = { id: 'P3', samo_depts: ['SE', 'นายกสโม'] };
  const oldRow   = { id: 'P4', samo_depts: ['ฝ่ายที่ถูกลบไปแล้ว'] }; // unknown value, old data

  it('no selection — everything matches, including an untagged โครงการ', () => {
    expect(projectMatchesSamoDepts(untagged, [])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, [])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, null)).toBe(true);
  });

  it('one selected ฝ่าย — matches a โครงการ carrying it, not one without it', () => {
    expect(projectMatchesSamoDepts(oneTag, ['SE'])).toBe(true);
    expect(projectMatchesSamoDepts(untagged, ['SE'])).toBe(false);
    expect(projectMatchesSamoDepts(twoTags, ['นายกสโม'])).toBe(true);
  });

  it('several selected ฝ่าย — OR, not AND', () => {
    expect(projectMatchesSamoDepts(oneTag, ['SE', 'อุปนายกฝ่ายวิชาการ'])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, ['อุปนายกฝ่ายวิชาการ', 'นายกสโม'])).toBe(false);
  });

  it('an untagged โครงการ never matches a non-empty selection', () => {
    expect(projectMatchesSamoDepts(untagged, ['SE'])).toBe(false);
  });

  it('a tag value no longer in VS_DEPTS still renders, and still filters', () => {
    // samoDeptLabel falls back to the raw value instead of disappearing.
    expect(samoDeptLabel('ฝ่ายที่ถูกลบไปแล้ว')).toBe('ฝ่ายที่ถูกลบไปแล้ว');
    // And the filter logic doesn't special-case it either way: it's a
    // string like any other, matched or not matched on its own terms.
    expect(projectMatchesSamoDepts(oldRow, ['ฝ่ายที่ถูกลบไปแล้ว'])).toBe(true);
    expect(projectMatchesSamoDepts(oldRow, ['SE'])).toBe(false);
  });

  it('a known value renders its real Thai label', () => {
    expect(samoDeptLabel('SE')).toBe('SE (Student Engagement)');
  });
});

describe('ratchet — the SQL allow-list is the SAME set as VS_DEPTS', () => {
  it('SAMO_DEPT_VALUES is exactly VS_DEPTS\' values', () => {
    expect(SAMO_DEPT_VALUES).toEqual(VS_DEPTS.map((d) => d.value));
  });

  // Migration 0212's set_project_samo_depts() carries its own `allowed
  // text[] := array[...]` literal — it has to, SQL can't import a JS module.
  // Parsed here and compared as a SET (never a hand-maintained comment,
  // which is exactly the shape mistakes class 6 keeps catching) so the two
  // cannot drift apart without this test noticing.
  it('migration 0212\'s allowed array equals VS_DEPTS\' values', () => {
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/0212_project_samo_depts.sql'), 'utf8',
    );
    const m = sql.match(/allowed text\[\] := array\[([^\]]+)\]/s);
    expect(m, 'could not find the `allowed text[] := array[...]` literal in 0212').toBeTruthy();
    const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values)).toEqual(new Set(SAMO_DEPT_VALUES));
  });
});
