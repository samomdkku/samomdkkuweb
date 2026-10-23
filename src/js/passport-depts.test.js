// ============================================================
// passport-depts.test.js — Passport's ฝ่าย list has ONE home: the database.
//
// Until 2026-10-23 the ten ฝ่าย and four ฝ่ายย่อย were typed FOUR times —
// passport/js/constants.js, four <select>s in passport/html/admin.html, and
// SUB_DEPT_OPTIONS in admin-page.js — beside the passport.departments table,
// and the copies already disagreed (the table said "อุปนายกฝ่ายบริหารองค์กร",
// the pages "บริหารองค์กร"). Adding "ฝ่าย รพ. ร่วมผลิต" would have been a code
// change in four files. 0247 made the table THE list, managed by Passport's
// admins and picked from ทีม SAMO; js/depts.js loads it for every page.
//
// This holds the property, not the shape: no file may carry a ฝ่าย NAME as
// data, and every page that shows one loads the catalog first.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Names that were hand-typed before 0247. If one comes back as DATA (outside a
// comment), a second list is being grown beside the table.
const OLD_NAMES = ['บริหารองค์กร', 'ดิจิทัลและสื่อสารองค์กร', 'กิจการภายใน', 'กิจการภายนอก',
  'กิจการมหาวิทยาลัย', 'วิชาการ', 'ยุทธศาสตร์และพัฒนาองค์กร', 'คุณภาพชีวิตและสิ่งแวดล้อม',
  'เวชนิทัศน์', 'รังสีเทคนิค', 'จิตอาสา', 'ชุมนุม', '7 คณะ'];

const htmlNoComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

describe('no second copy of the Passport ฝ่าย list', () => {
  const files = readdirSync(join(ROOT, 'passport/js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => `passport/js/${f}`);

  it('the sweep looked at the passport scripts and admin page (control)', () => {
    expect(files).toContain('passport/js/admin-page.js');
    expect(files).toContain('passport/js/dashboard.js');
    expect(files.length).toBeGreaterThan(8);
  });

  for (const f of files) {
    it(`${f} carries no ฝ่าย name as data`, () => {
      const code = stripComments(read(f));
      const hits = OLD_NAMES.filter((n) => code.includes(`'${n}'`) || code.includes(`"${n}"`) || code.includes(`: '${n}`));
      expect(hits, `${f} spells ฝ่าย names in code — read them from js/depts.js (0247)`).toEqual([]);
    });
  }

  it('html/admin.html has no hand-typed ฝ่าย <option>', () => {
    const html = htmlNoComments(read('passport/html/admin.html'));
    const opts = [...html.matchAll(/<option value="(\d+)">([^<]*)<\/option>/g)].map((m) => m[2]);
    expect(opts, 'admin.html lists ฝ่าย by hand again — fillDeptSelect() fills these').toEqual([]);
  });

  it('constants.js exports the maps EMPTY (depts.js fills them)', () => {
    const code = stripComments(read('passport/js/constants.js'));
    for (const name of ['DEPARTMENTS', 'SUBDEPARTMENTS', 'SUBDEPT_PARENT']) {
      expect(code).toMatch(new RegExp(`export const ${name} = \\{\\};`));
    }
  });
});

describe('every page that shows a ฝ่าย loads the catalog first', () => {
  it('the admin panel loads it BEFORE filling and narrowing the selects', () => {
    const code = stripComments(read('passport/js/admin-page.js'));
    const body = code.slice(code.indexOf('async function showAdminPanel'));
    const load = body.indexOf('await loadDepartments(adminDb)');
    const fill = body.indexOf('fillAllDeptSelects()');
    const scope = body.indexOf('applyScopeToUi()');
    expect(load).toBeGreaterThan(-1);
    expect(load).toBeLessThan(fill);
    expect(fill).toBeLessThan(scope);
  });

  it('the dashboard loads it with its data, and before the leaderboard filter', () => {
    const code = stripComments(read('passport/js/dashboard.js'));
    expect(code).toMatch(/loadDepartments\(\),/);
    const lb = code.slice(code.indexOf('async function ensureLbPageData'));
    expect(lb.slice(0, 400)).toContain('await loadDepartments()');
  });

  it('the scope helpers read the parent map that depts.js fills', () => {
    expect(stripComments(read('passport/js/admin-scope.js'))).toMatch(/import \{ SUBDEPT_PARENT \} from '\.\/constants\.js'/);
  });
});

// depts.js itself, against a stub client — what comes OUT.
describe('depts.js', () => {
  let mod;
  beforeEach(async () => {
    mod = await import('../../passport/js/depts.js?' + Math.random());
  });
  const catalog = {
    departments: [
      { id: 6, name: 'วิชาการ', active: true, sort_order: 60 },
      { id: 11, name: 'ฝ่าย รพ. ร่วมผลิต', active: true, sort_order: 110 },
      { id: 9, name: 'เวชนิทัศน์', active: false, sort_order: 90 },
    ],
    sub_departments: [
      { id: 5, department_id: 11, name: 'รพ. ขอนแก่น', active: true },
      { id: 6, department_id: 11, name: 'รพ. มหาสารคาม', active: false },
    ],
  };

  it('fills the shared maps in place, hidden rows included (old work keeps its label)', async () => {
    const constants = await import('../../passport/js/constants.js');
    mod.applyCatalog(catalog);
    expect(constants.DEPARTMENTS[11]).toBe('ฝ่าย รพ. ร่วมผลิต');
    expect(constants.DEPARTMENTS[9]).toBe('เวชนิทัศน์');
    expect(constants.SUBDEPT_PARENT[5]).toBe(11);
  });

  it('a FORM offers active ฝ่าย only, plus the value an activity already has', () => {
    mod.applyCatalog(catalog);
    expect(mod.deptChoices().map((d) => d.id)).toEqual([6, 11]);
    expect(mod.deptChoices({ keep: 9 }).map((d) => d.id)).toEqual([6, 11, 9]);
    expect(mod.deptChoices({ includeHidden: true }).map((d) => d.id)).toEqual([6, 11, 9]);
    expect(mod.subChoices(11).map((s) => s.id)).toEqual([5]);
    expect(mod.subChoices(11, { keep: 6 }).map((s) => s.id)).toEqual([5, 6]);
  });

  it('an unknown id is visible as such, never blank', () => {
    mod.applyCatalog(catalog);
    expect(mod.deptName(99)).toBe('ฝ่าย #99');
    expect(mod.deptName(null)).toBe('');
  });
});
