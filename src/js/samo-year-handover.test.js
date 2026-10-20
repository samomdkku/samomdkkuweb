// The ปี admin page (samo-year-admin.js): its pure half, and three ratchets for
// what it exists to stop — a year printed "2,569", a second home for the
// year switch, and a page gate that disagrees with the RPCs behind it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { handoverState, startTargetError, nextPassportName, passportAlreadyOn } from './samo-year-handover.js';
import { stripComments } from './strip-comments.js';

const T = (year, extra = {}) => ({ year, is_current: false, published_at: null, ...extra });

describe('handoverState', () => {
  it('no current year: nothing to hand over, no target offered', () => {
    const st = handoverState([T(2569), T(2570)]);
    expect(st.current).toBeNull();
    expect(st.next).toBeNull();
    expect(st.published).toBe(false);
  });

  it('offers the nearest REGISTERED year above the current one (production today: 2569 → 2570)', () => {
    const st = handoverState([T(2569, { is_current: true }), T(2571), T(2570)]);
    expect(st.current.year).toBe(2569);
    expect(st.next).toBe(2570);
    expect(st.others.map((t) => t.year)).toEqual([2571, 2570]);
  });

  it('offers current + 1 when no later year is registered (start_team_term creates it)', () => {
    expect(handoverState([T(2568), T(2569, { is_current: true })]).next).toBe(2570);
  });

  it('step 2 has begun only when the tree moved AFTER a publish', () => {
    const pub = [T(2569, { is_current: true, published_at: '2026-10-20T00:00:00Z' })];
    expect(handoverState(pub, new Map([[2569, true]])).editing).toBe(true);
    expect(handoverState(pub, new Map([[2569, false]])).editing).toBe(false);
    // Never published: "stale" cannot mean "editing for the next team".
    const unpub = [T(2569, { is_current: true })];
    expect(handoverState(unpub, new Map([[2569, true]])).editing).toBe(false);
  });

  it('a target past the registry bound is not offered', () => {
    expect(handoverState([T(2700, { is_current: true })]).next).toBeNull();
  });
});

describe('startTargetError — step 3 only goes FORWARD', () => {
  it('accepts a later year', () => { expect(startTargetError(2570, 2569)).toBe(''); });
  it('refuses the current year and an earlier one (going back is ปีอื่น ๆ)', () => {
    expect(startTargetError(2569, 2569)).not.toBe('');
    expect(startTargetError(2568, 2569)).not.toBe('');
  });
  it('refuses a non-year', () => {
    expect(startTargetError(25, 2569)).not.toBe('');
    expect(startTargetError(NaN, 2569)).not.toBe('');
    expect(startTargetError(2569.5, null)).not.toBe('');
  });
});

describe('nextPassportName — carries ฝ่าย กิจกรรม\'s own naming forward', () => {
  it("swaps the two-digit year of production's name", () => {
    expect(nextPassportName("MDKKU SAMO'69", 2570)).toBe("MDKKU SAMO'70");
  });
  it('keeps a typographic apostrophe', () => {
    expect(nextPassportName('วาระสโม’69', 2570)).toBe('วาระสโม’70');
  });
  it('falls back to a fixed pattern for a name with no year in it', () => {
    expect(nextPassportName('Season one', 2570)).toBe("MDKKU SAMO'70");
    expect(nextPassportName(null, 2601)).toBe("MDKKU SAMO'01");
  });
});

describe('passportAlreadyOn', () => {
  it('is true only for a วาระ bridged to that exact year', () => {
    expect(passportAlreadyOn({ team_term_year: 2570 }, 2570)).toBe(true);
    expect(passportAlreadyOn({ team_term_year: 2569 }, 2570)).toBe(false);
    // Production's วาระ has a NULL bridge — not "already", or a start would skip it.
    expect(passportAlreadyOn({ team_term_year: null }, 2570)).toBe(false);
    expect(passportAlreadyOn(null, 2570)).toBe(false);
  });
});

// ── ratchets ────────────────────────────────────────────────────────────────

const SRC = new URL('.', import.meta.url).pathname;
const ROOT = join(SRC, '..', '..');
function jsFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (f.endsWith('.js') && !f.endsWith('.test.js') && !f.includes('fixture')) out.push(p);
  }
  return out;
}

// toLocaleString('th-TH') groups thousands — a year came out "2,569" on the
// ระบบบ้าน admin page (owner, 2026-10-20). Counts are fine; YEARS are not.
// The name must END in year (year, clock_year, samoYearBe) — `yearKm` is a
// distance and correctly grouped.
const YEAR_LOCALE = /[yY]ear(?:_?[bB][eE])?\)?(?:\s*[+-]\s*\d+\))?\.toLocaleString\(/;

describe('a year is never formatted with toLocaleString', () => {
  it('CONTROL — the pattern catches the three lines that shipped it', () => {
    expect(YEAR_LOCALE.test("<strong>${year ? year.toLocaleString('th-TH') : '—'}</strong>")).toBe(true);
    expect(YEAR_LOCALE.test("เลื่อนเป็น ${year ? (year + 1).toLocaleString('th-TH') : ''}")).toBe(true);
    expect(YEAR_LOCALE.test("${Number(ay.clock_year).toLocaleString('th-TH')}")).toBe(true);
    // …and leaves a COUNT and a date's `year:` option alone.
    expect(YEAR_LOCALE.test("${aboutToGraduate.toLocaleString('th-TH')} คน")).toBe(false);
    expect(YEAR_LOCALE.test("d.toLocaleString('en-GB', { year: 'numeric' })")).toBe(false);
    expect(YEAR_LOCALE.test('sideKm.textContent = yearKm.toLocaleString();')).toBe(false);
  });

  it('no source file does it', () => {
    const offenders = [];
    for (const f of [...jsFiles(SRC), ...jsFiles(join(ROOT, 'passport', 'js'))]) {
      stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        if (YEAR_LOCALE.test(line)) offenders.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the ปี SAMO switch has ONE home', () => {
  it('only team/api.js names the RPCs that move it', () => {
    const callers = jsFiles(SRC).filter((f) => /rpc\/start_(team_term|samo_year)\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(callers).toEqual(['team/api.js']);
  });

  it('ทีม SAMO → ทีมแต่ละปี no longer offers ตั้งเป็นปีปัจจุบัน', () => {
    const terms = stripComments(readFileSync(join(SRC, 'team', 'terms.js'), 'utf8'));
    expect(terms).not.toMatch(/data-term-current/);
    expect(terms).not.toMatch(/startSamoYear|setCurrentTerm/);
    expect(terms).toMatch(/data-term-goto-year/);
  });

  it('ระบบบ้าน no longer moves ปีการศึกษา itself — it links to the ปี page', () => {
    const house = stripComments(readFileSync(join(SRC, 'house', 'index.js'), 'utf8'));
    expect(house).not.toMatch(/saveAcademicYear/);
    expect(house).toMatch(/openAdminSection\?\.\('years'\)/);
  });
});

describe("the page's gate is the RPCs' own gates", () => {
  // The newest migration that (re)defines a function holds its live gate.
  const MIG = join(ROOT, 'supabase', 'migrations');
  const newestDef = (fn) => readdirSync(MIG).sort().reverse()
    .map((f) => readFileSync(join(MIG, f), 'utf8'))
    .find((s) => new RegExp(`create or replace function public\\.${fn}\\(`).test(s));
  const main = readFileSync(join(SRC, 'admin-main.js'), 'utf8');
  const side = main.match(/^\s*years:\s*\[([^\]]*)\]/m);

  it('SIDE_FEATURE.years is a list', () => { expect(side).not.toBeNull(); });

  it("start_team_term gates on team_edit, and so does the page", () => {
    expect(newestDef('start_team_term')).toMatch(/current_user_has_permission\('team_edit'\)/);
    expect(side[1]).toMatch(/'team_edit'/);
  });

  it("set_academic_year gates on house, and so does the page", () => {
    expect(newestDef('set_academic_year')).toMatch(/current_user_has_permission\('house'\)/);
    expect(side[1]).toMatch(/'house'/);
  });

  it("start_samo_year asks Passport's own org-wide answer, never a re-derivation", () => {
    expect(newestDef('start_samo_year')).toMatch(/passport_admin_context\(\)\s*->>\s*'all_departments'/);
  });
});
