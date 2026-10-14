// ============================================================
// depts.test.js — DEPT_DEFS carries all 12 ฝ่าย, every colour it names
// exists, and no migration hands out a หน้าฝ่าย grant (0213).
//
// WHY THIS EXISTS. Before 0213, DEPT_DEFS carried 6 of the 12 top-level ฝ่าย
// ทีม SAMO's own tree has — the other six existed as disabled "เร็วๆ นี้"
// placeholder cards nobody could open, and none of their people could be
// granted a page to edit because the grant list (DEPT_PAGES / DEPT_OPTIONS) is
// DERIVED from this same object. One omission here meant a dept had no page,
// no grant, and no complaint path except "ask IT".
//
// WHO edits each page is chosen in ทีม SAMO → สิทธิ์ → หน้าฝ่าย (owner,
// 2026-10-13), never written by a migration: the night agent's first 0213
// would have granted ~240 accounts at once. The block at the bottom keeps
// it that way.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DEPT_DEFS, DEPT_KEYS, DEPT_OPTIONS } from './depts.js';
import { DEPT_PAGES } from '../js/team-vocab.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
// `set dept_page = <anything but null>` inside an UPDATE of a team table.
const GRANTS = /update\s+public\.team_(nodes|members)\b[^;]*?\bset\s+(?:[^;]*?,\s*)?dept_page\s*=\s*(?!null\b)/i;

const THE_12_TITLES = [
  'สำนักนายกฯ',
  'ฝ่ายบริหารองค์กร',
  'ฝ่ายดิจิทัลและสื่อสารองค์กร',
  'ฝ่ายกิจการภายใน',
  'ฝ่ายกิจการภายนอก',
  'ฝ่ายกิจการมหาวิทยาลัย',
  'ฝ่ายวิชาการ',
  'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
  'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
  'ฝ่ายรังสีเทคนิค',
  'ฝ่ายเวชนิทัศน์',
  'ฝ่าย รพ. ร่วมผลิต',
];

describe('DEPT_DEFS carries every ฝ่าย the tree has', () => {
  it('has all 12 top-level titles, each exactly once', () => {
    const titles = Object.values(DEPT_DEFS).map((d) => d.title);
    expect(new Set(titles).size, 'a duplicate title in DEPT_DEFS').toBe(titles.length);
    const missing = THE_12_TITLES.filter((t) => !titles.includes(t));
    expect(missing, `DEPT_DEFS is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key has a colour token that actually exists in base.css', () => {
    const base = read('src/css/base.css');
    const missing = Object.entries(DEPT_DEFS)
      .filter(([, d]) => !new RegExp(`${d.colorVar}\\s*:`).test(base))
      .map(([k, d]) => `${k} (${d.colorVar})`);
    expect(missing, `no custom property in base.css for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the control — a colour token that does not exist would be caught', () => {
    const base = read('src/css/base.css');
    expect(new RegExp('--dept-nosuchdept\\s*:').test(base)).toBe(false);
  });

  it('สำนักนายกฯ and ฝ่าย รพ. ร่วมผลิต get their OWN colour, distinct from the other ten', () => {
    // Both were asked to be distinguishable from the ten that already existed
    // — asserted on the resolved hex values themselves, not just "some token
    // exists", or two depts could still share one colour by accident.
    const base = read('src/css/base.css');
    const hexOf = (varName) => {
      const m = base.match(new RegExp(`${varName}:\\s*(#[0-9A-Fa-f]{3,8})`));
      return m ? m[1].toLowerCase() : null;
    };
    const allVars = Object.values(DEPT_DEFS).map((d) => d.colorVar);
    const hexes = allVars.map(hexOf);
    expect(hexes.every(Boolean), `could not resolve a hex for every dept colorVar: ${allVars.join(', ')}`).toBe(true);
    expect(new Set(hexes).size, 'two ฝ่าย share the exact same colour hex').toBe(hexes.length);
  });

  it('every colorVar is --dept-<own key> — no ฝ่าย borrows another concept\'s token', () => {
    // ฝ่ายรังสีเทคนิค (rt) used to point at --dept-projects — a token meant
    // for "โครงการอื่นๆ" (an unrelated tool-card colour, see tools.js), not a
    // department at all. It happened to resolve to a hex no OTHER dept used,
    // so the "distinct hex" test above stayed green while the token itself
    // was still borrowed. See docs/mistakes/app-state.md.
    const wrong = Object.entries(DEPT_DEFS)
      .filter(([k, d]) => d.colorVar !== `--dept-${k}`)
      .map(([k, d]) => `${k} → ${d.colorVar}`);
    expect(wrong, `colorVar does not match its own key: ${wrong.join(', ')}`).toEqual([]);
  });

  it('DEPT_PAGES (the grant picker) offers all 12, derived — not a second list', () => {
    expect(DEPT_PAGES).toEqual(DEPT_OPTIONS);
    expect(DEPT_KEYS.length).toBe(12);
    const labels = DEPT_PAGES.map((d) => d.label);
    const missing = THE_12_TITLES.filter((t) => !labels.includes(t));
    expect(missing, `DEPT_PAGES cannot grant: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('หน้าฝ่าย grants come from ทีม SAMO, never from a migration (0213)', () => {
  // EVERY migration, not just 0213 — the property is "no file grants", and a
  // list of the files we happened to think of would pass a new one that does.
  const dir = `${ROOT}supabase/migrations`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const code = (f) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, '');

  it('reads the migrations at all (a sweep that finds nothing must prove it looked)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.startsWith('0213_'))).toBe(true);
  });

  it('control: the pattern DOES catch the draft 0213 the owner turned down', () => {
    const draft = "update public.team_nodes t\n   set dept_page = v.dept_key\n  from (values ('ฝ่ายกิจการภายใน','internal')) v(n,k)";
    expect(GRANTS.test(draft)).toBe(true);
  });

  it('no migration sets team_nodes.dept_page or team_members.dept_page to a value', () => {
    const offenders = files.filter((f) => GRANTS.test(code(f)));
    expect(offenders, [
      'A migration writes a หน้าฝ่าย grant. Who edits a ฝ่าย\'s public page is chosen',
      'by an admin in ทีม SAMO → สิทธิ์ → หน้าฝ่าย (owner, 2026-10-13); a grant made',
      'in SQL is invisible to the people who manage the tree.',
    ].join('\n')).toEqual([]);
  });
});

// ── The card grid is hand-written HTML; DEPT_DEFS is where a ฝ่าย's mark
// lives. Two homes for one fact (mistakes class 6), so they are compared here:
// a logo changed in one place and not the other, or a path to a file that is
// not there (nginx's SPA fallback answers 200 with HTML, so a wrong path is a
// silently broken image, never a 404 anyone sees), fails the build.
describe('the ฝ่าย mark: DEPT_DEFS, the card grid and public/ agree', () => {
  const grid = read('src/html/tab-departments.html');
  const cardFor = (key) => grid.match(new RegExp(`data-dept-open="${key}"[\\s\\S]*?</a>`))?.[0] || '';

  it('every key has a card to compare (control)', () => {
    for (const k of DEPT_KEYS) expect(cardFor(k), k).not.toBe('');
  });

  it('a ฝ่าย with a logo shows THAT file on its card, and no glyph', () => {
    const bad = DEPT_KEYS.filter((k) => DEPT_DEFS[k].logo).filter((k) => {
      const card = cardFor(k);
      return !card.includes(`src="${DEPT_DEFS[k].logo}"`) || /<i class="bi /.test(card);
    });
    expect(bad).toEqual([]);
  });

  it('a ฝ่าย without one shows its own glyph', () => {
    const bad = DEPT_KEYS.filter((k) => !DEPT_DEFS[k].logo)
      .filter((k) => !cardFor(k).includes(`<i class="bi ${DEPT_DEFS[k].icon}"`));
    expect(bad).toEqual([]);
  });

  it('every logo is a real PNG under public/', () => {
    const bad = DEPT_KEYS.filter((k) => DEPT_DEFS[k].logo).filter((k) => {
      try {
        const buf = readFileSync(`${ROOT}public${DEPT_DEFS[k].logo}`);
        return buf.subarray(1, 4).toString('latin1') !== 'PNG';
      } catch { return true; }
    });
    expect(bad).toEqual([]);
  });
});
