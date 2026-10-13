// ==============================================
// samo-depts.test.js — ฝ่ายสโม tags: the filter logic, and the ratchet that
// keeps the SQL allow-list and the 12 ฝ่าย (DEPT_KEYS) from drifting apart
// (mistakes class 6 — a second taxonomy, or a correct one that silently rots).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SAMO_DEPT_VALUES,
  SAMO_DEPT_OPTIONS,
  projectSamoDepts,
  projectMatchesSamoDepts,
  samoDeptLabel,
} from './samo-depts.js';
import { readdirSync } from 'node:fs';
import { DEPT_KEYS } from '../../data/depts.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

describe('projectSamoDepts — normalising the stored column', () => {
  it('returns [] for a missing/null/non-array value', () => {
    expect(projectSamoDepts({})).toEqual([]);
    expect(projectSamoDepts({ samo_depts: null })).toEqual([]);
    expect(projectSamoDepts({ samo_depts: 'not-an-array' })).toEqual([]);
    expect(projectSamoDepts(null)).toEqual([]);
  });

  it('passes through a real tag list, dropping falsy entries', () => {
    expect(projectSamoDepts({ samo_depts: ['office', '', null, 'academic'] }))
      .toEqual(['office', 'academic']);
  });
});

describe('projectMatchesSamoDepts — the filter', () => {
  const untagged = { id: 'P1', samo_depts: [] };
  const oneTag   = { id: 'P2', samo_depts: ['office'] };
  const twoTags  = { id: 'P3', samo_depts: ['office', 'academic'] };
  const oldRow   = { id: 'P4', samo_depts: ['ฝ่ายที่ถูกลบไปแล้ว'] }; // unknown value, old data

  it('no selection — everything matches, including an untagged โครงการ', () => {
    expect(projectMatchesSamoDepts(untagged, [])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, [])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, null)).toBe(true);
  });

  it('one selected ฝ่าย — matches a โครงการ carrying it, not one without it', () => {
    expect(projectMatchesSamoDepts(oneTag, ['office'])).toBe(true);
    expect(projectMatchesSamoDepts(untagged, ['office'])).toBe(false);
    expect(projectMatchesSamoDepts(twoTags, ['academic'])).toBe(true);
  });

  it('several selected ฝ่าย — OR, not AND', () => {
    expect(projectMatchesSamoDepts(oneTag, ['office', 'rt'])).toBe(true);
    expect(projectMatchesSamoDepts(oneTag, ['rt', 'academic'])).toBe(false);
  });

  it('an untagged โครงการ never matches a non-empty selection', () => {
    expect(projectMatchesSamoDepts(untagged, ['office'])).toBe(false);
  });

  it('a tag value that is no longer a ฝ่าย key still renders, and still filters', () => {
    // samoDeptLabel falls back to the raw value instead of disappearing.
    expect(samoDeptLabel('ฝ่ายที่ถูกลบไปแล้ว')).toBe('ฝ่ายที่ถูกลบไปแล้ว');
    // And the filter logic doesn't special-case it either way: it's a
    // string like any other, matched or not matched on its own terms.
    expect(projectMatchesSamoDepts(oldRow, ['ฝ่ายที่ถูกลบไปแล้ว'])).toBe(true);
    expect(projectMatchesSamoDepts(oldRow, ['office'])).toBe(false);
  });

  it('a known key renders the ฝ่าย title', () => {
    expect(samoDeptLabel('hospital')).toBe('ฝ่าย รพ. ร่วมผลิต');
  });
});

// The owner's list, 2026-10-13 — "the ฝ่าย in หนังสือโครงการ should only be
// these … it shouldn't have SE". The 12 ฝ่าย of หน้าฝ่าย, in that order.
const OWNER_LIST = [
  'สำนักนายกฯ', 'ฝ่ายบริหารองค์กร', 'ฝ่ายดิจิทัลและสื่อสารองค์กร', 'ฝ่ายกิจการภายใน',
  'ฝ่ายกิจการภายนอก', 'ฝ่ายกิจการมหาวิทยาลัย', 'ฝ่ายวิชาการ', 'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
  'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม', 'ฝ่ายรังสีเทคนิค', 'ฝ่ายเวชนิทัศน์', 'ฝ่าย รพ. ร่วมผลิต',
];

describe('the tag list is the 12 ฝ่าย, and the SQL agrees', () => {
  it('shows exactly the owner\'s 12 ฝ่าย, in order — no VitalSound desk (SE, นายกสโม, อุปนายก…)', () => {
    expect(SAMO_DEPT_OPTIONS.map((d) => d.label)).toEqual(OWNER_LIST);
    expect(SAMO_DEPT_OPTIONS.some((d) => /SE|นายกสโม|อุปนายก/.test(d.label + d.value))).toBe(false);
  });

  it('stores DEPT_DEFS keys — the identifiers หน้าฝ่าย already uses', () => {
    expect(SAMO_DEPT_VALUES).toEqual(DEPT_KEYS);
  });

  // SQL cannot import a JS module, so public.samo_dept_keys() carries a copy.
  // Read the NEWEST definition across every migration (a later file replaces
  // an earlier one) and compare it to DEPT_KEYS — never a comment.
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const newest = (re) => files.filter((f) => re.test(readFileSync(join(dir, f), 'utf8'))).pop();

  it('the newest public.samo_dept_keys() equals DEPT_KEYS', () => {
    const f = newest(/function public\.samo_dept_keys\(\)/);
    expect(f, 'no migration defines public.samo_dept_keys()').toBeTruthy();
    const body = readFileSync(join(dir, f), 'utf8').match(/function public\.samo_dept_keys\(\)[\s\S]*?array\[([\s\S]*?)\]/);
    const values = [...body[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(values).toEqual(DEPT_KEYS);
  });

  it('the newest set_project_samo_depts and its guard ask samo_dept_keys(), not a list of their own', () => {
    for (const fn of ['set_project_samo_depts', 'projects_samo_depts_guard']) {
      const f = newest(new RegExp(`function public\\.${fn}\\(`));
      const sql = readFileSync(join(dir, f), 'utf8');
      const def = sql.slice(sql.indexOf(`function public.${fn}(`));
      const body = def.slice(0, def.indexOf('$$;', def.indexOf('$$') + 2));
      expect(body, `${fn} (newest in ${f}) must check values via samo_dept_keys()`).toContain('samo_dept_keys()');
      expect(body).not.toMatch(/allowed text\[\]/);
    }
  });
});

describe('staleSamoDepts — a renamed ฝ่าย must stay removable', () => {
  it('returns only values that are not a ฝ่าย key', async () => {
    const { staleSamoDepts, SAMO_DEPT_VALUES } = await import('./samo-depts.js');
    expect(staleSamoDepts({ samo_depts: [SAMO_DEPT_VALUES[0], 'ฝ่ายที่ถูกเปลี่ยนชื่อ'] })).toEqual(['ฝ่ายที่ถูกเปลี่ยนชื่อ']);
    expect(staleSamoDepts({ samo_depts: [] })).toEqual([]);
    expect(staleSamoDepts({})).toEqual([]);
  });
});
