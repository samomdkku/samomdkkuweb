// ==============================================
// fiscal-year.test.js — the ปีงบประมาณ rule, and the RATCHET that keeps it
// ONE rule.
//
// §1 the arithmetic and its BOUNDARY (30 ก.ย. vs 1 ต.ค. — the whole rule
//    lives in one day, so that day is what gets asserted)
// §2 the OVERRIDE: what a human said beats what the clock says, and
//    "no opinion" stays expressible
// §3 the DEFAULT filter: the three stored shapes, and the one that has to
//    keep answering correctly after 1 ต.ค. 2570 with nobody touching it
// §4 the RATCHET. `+ 543` was inlined in inbox.js before this module
//    existed. This repo's standing lesson is that a second implementation
//    of one rule drifts (mistakes class 6) and that a comment saying "keep
//    in step" is not a mechanism — so §4 reads the SOURCE of every projects
//    module and fails the build if the arithmetic comes back anywhere else.
// §5 the JS shapes and the DB CHECK constraint are the same vocabulary.
//    They are two implementations of one rule by construction (SQL↔JS
//    mirror), so the migration's own regex is asserted here.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import { join } from 'node:path';
import {
  deriveFiscalYearBE,
  projectFiscalYear,
  isFiscalYearMoved,
  currentFiscalYearBE,
  resolveDefaultFY,
  isValidDefaultFY,
  fiscalYearOptions,
  moveTargetYears,
  DEFAULT_FY_ALL,
  DEFAULT_FY_CURRENT,
} from './fiscal-year.js';

const HERE = new URL('.', import.meta.url).pathname;

// Local-time constructor: the rule is defined on the VIEWER's calendar
// (audience is in ICT), so the fixtures must be local dates too — a
// `new Date('2026-10-01T00:00:00Z')` is 30 ก.ย. in some zones and would
// make this suite pass or fail depending on where it runs.
const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('§1 the ปีงบประมาณ arithmetic', () => {
  it('names the year the budget year ENDS in', () => {
    // ปีงบ 2569 = 1 ต.ค. 2568 (=2025) → 30 ก.ย. 2569 (=2026)
    expect(deriveFiscalYearBE(local(2026, 3, 15))).toBe(2569);
  });

  it('rolls over on 1 ต.ค., not on 1 ม.ค.', () => {
    expect(deriveFiscalYearBE(local(2026, 9, 30, 23))).toBe(2569);
    expect(deriveFiscalYearBE(local(2026, 10, 1, 0))).toBe(2570);
  });

  it('puts ต.ค.–ธ.ค. in the NEXT พ.ศ. year', () => {
    expect(deriveFiscalYearBE(local(2025, 12, 31))).toBe(2569);
    expect(deriveFiscalYearBE(local(2026, 1, 1))).toBe(2569);
  });

  it('answers null for an absent or unparseable date rather than a wrong year', () => {
    expect(deriveFiscalYearBE(null)).toBeNull();
    expect(deriveFiscalYearBE('')).toBeNull();
    expect(deriveFiscalYearBE('not a date')).toBeNull();
  });

  it('currentFiscalYearBE reads the same rule', () => {
    expect(currentFiscalYearBE(new Date(2026, 8, 30))).toBe(2569);
    expect(currentFiscalYearBE(new Date(2026, 9, 1))).toBe(2570);
  });
});

describe('§2 the override — what a human said beats what the clock says', () => {
  const sept = { created_at: local(2026, 9, 20) };   // derives 2569

  it('derives when nothing was set', () => {
    expect(projectFiscalYear(sept)).toBe(2569);
    expect(isFiscalYearMoved(sept)).toBe(false);
  });

  it('uses the override when one was set', () => {
    const moved = { ...sept, fiscal_year_be: 2570 };
    expect(projectFiscalYear(moved)).toBe(2570);
    expect(isFiscalYearMoved(moved)).toBe(true);
  });

  it('treats NULL as "ask the clock", so a corrected created_at re-derives', () => {
    // This is the 0128 shape: a column FILLED ONCE from an expression stops
    // tracking that expression forever. NULL has to keep meaning "no opinion".
    const p = { created_at: local(2026, 9, 20), fiscal_year_be: null };
    expect(projectFiscalYear(p)).toBe(2569);
    p.created_at = local(2026, 10, 2);
    expect(projectFiscalYear(p)).toBe(2570);
  });

  it('does not call an override that AGREES with the date a move', () => {
    // The pill must not shout "ย้ายเอง" at somebody who picked the same year.
    expect(isFiscalYearMoved({ ...sept, fiscal_year_be: 2569 })).toBe(false);
  });

  it('ignores a junk override rather than rendering NaN', () => {
    expect(projectFiscalYear({ ...sept, fiscal_year_be: 0 })).toBe(2569);
    expect(projectFiscalYear({ ...sept, fiscal_year_be: null })).toBe(2569);
    expect(projectFiscalYear({ ...sept, fiscal_year_be: 'x' })).toBe(2569);
  });
});

describe('§3 the per-person default filter', () => {
  it('accepts exactly the three stored shapes', () => {
    expect(isValidDefaultFY('all')).toBe(true);
    expect(isValidDefaultFY('current')).toBe(true);
    expect(isValidDefaultFY('2569')).toBe(true);
    expect(isValidDefaultFY('569')).toBe(false);
    expect(isValidDefaultFY('')).toBe(false);
    expect(isValidDefaultFY(null)).toBe(false);
    expect(isValidDefaultFY('newest')).toBe(false);
  });

  it('resolves an unreadable preference to ทุกปีงบ, never to an empty screen', () => {
    expect(resolveDefaultFY(undefined)).toBe(DEFAULT_FY_ALL);
    expect(resolveDefaultFY('garbage')).toBe(DEFAULT_FY_ALL);
  });

  it('resolves "current" at OPEN time — that is the whole point of the option', () => {
    expect(resolveDefaultFY(DEFAULT_FY_CURRENT, new Date(2026, 8, 30))).toBe('2569');
    // Same stored value, one day later, different answer. Nobody edited it.
    expect(resolveDefaultFY(DEFAULT_FY_CURRENT, new Date(2026, 9, 1))).toBe('2570');
  });

  it('keeps a fixed year fixed', () => {
    expect(resolveDefaultFY('2569', new Date(2028, 0, 1))).toBe('2569');
  });
});

describe('§3b the dropdown must be able to SHOW what the default resolves to', () => {
  const projects = [
    { created_at: local(2026, 3, 1) },   // 2569
    { created_at: local(2025, 3, 1) },   // 2568
  ];

  it('lists the years the projects occupy, newest first', () => {
    expect(fiscalYearOptions(projects, { now: new Date(2026, 3, 1) }))
      .toEqual(['2569', '2568']);
  });

  it('follows an OVERRIDDEN project into its new year', () => {
    const moved = [...projects, { created_at: local(2026, 3, 1), fiscal_year_be: 2571 }];
    expect(fiscalYearOptions(moved, { now: new Date(2026, 3, 1) })[0]).toBe('2571');
  });

  it('offers the CURRENT year before any project exists in it', () => {
    // 1 ต.ค. 2570: without this the saved "ปีงบปัจจุบัน" would resolve to a
    // year the <select> has no <option> for, and the browser would silently
    // fall back to the first option — ทุกปีงบ. The preference would look
    // like it had been forgotten.
    const opts = fiscalYearOptions(projects, { now: new Date(2026, 9, 1) });
    expect(opts).toContain('2570');
  });

  it('offers a FIXED default year even when its projects are all gone', () => {
    const opts = fiscalYearOptions(projects, { defaultFY: '2566', now: new Date(2026, 3, 1) });
    expect(opts).toContain('2566');
  });
});

describe('§3c the move-target list', () => {
  it('centres on the year the date implies and reaches the year after it', () => {
    // The whole reason this feature exists: sent ก.ย. 2569, booked as 2570.
    const p = { created_at: local(2026, 9, 20) };
    expect(moveTargetYears(p, [], { now: new Date(2026, 8, 20) })).toContain('2570');
    expect(moveTargetYears(p, [], { now: new Date(2026, 8, 20) })).toContain('2569');
  });

  it('always includes the year the project is CURRENTLY pinned to', () => {
    // Otherwise the dialog would open on a value it cannot display, and the
    // select would silently show a different year than the project has.
    const p = { created_at: local(2026, 3, 1), fiscal_year_be: 2575 };
    expect(moveTargetYears(p, [], { now: new Date(2026, 3, 1) })).toContain('2575');
  });

  it('stays inside the range the DB CHECK accepts', () => {
    const p = { created_at: local(2026, 3, 1) };
    for (const y of moveTargetYears(p, [], { now: new Date(2026, 3, 1) })) {
      expect(Number(y)).toBeGreaterThanOrEqual(2500);
      expect(Number(y)).toBeLessThanOrEqual(2700);
    }
  });
});

describe('§3d after a move, "where does it show up now" has ONE answer', () => {
  // REGRESSION. The move handler follows the viewer's ปีงบ filter to wherever
  // the project lands, so it does not vanish from under them. The first
  // version followed only when a NUMBER was written, so choosing
  // "ตามวันที่สร้าง (อัตโนมัติ)" — which writes NULL — skipped the follow and
  // produced exactly the disappearance the follow exists to prevent.
  //
  // The property: the resulting year is projectFiscalYear() of the row AS IT
  // WILL BE, for every value the dialog can return. Same function the grid
  // filter uses, so the two cannot disagree.
  const sept = { created_at: local(2026, 9, 20), fiscal_year_be: 2571 };
  const resulting = (p, picked) => projectFiscalYear({ ...p, fiscal_year_be: picked });

  it('clearing the override lands on the DERIVED year, not on nothing', () => {
    expect(resulting(sept, null)).toBe(2569);
  });

  it('and that year can differ from the one the filter is on — the bug', () => {
    // Viewer filtered to 2571 (where the override put it); clearing sends it
    // to 2569. A follow that only fires for a number leaves them on 2571
    // looking at a grid the project is no longer in.
    expect(String(resulting(sept, null))).not.toBe(String(projectFiscalYear(sept)));
  });

  it('setting a year lands on that year', () => {
    expect(resulting(sept, 2570)).toBe(2570);
  });

  it('agrees with the grid filter for every case', () => {
    for (const picked of [null, 2568, 2569, 2570]) {
      const after = { ...sept, fiscal_year_be: picked };
      expect(resulting(sept, picked)).toBe(projectFiscalYear(after));
    }
  });
});

describe('§3e the inbox shows the year, and BOTH layouts show the same one', () => {
  // The กล่องจดหมาย renders a โครงการ two ways — a grid card and a list row.
  // Two copies of "which ปีงบ is this" is mistakes class 6 by construction:
  // one gets the override, the other keeps deriving from created_at, and the
  // same โครงการ reads differently depending on a view toggle. So both must
  // go through the ONE helper.
  //
  // Reintroduce-the-bug check: inline the chip markup into renderProjectCard
  // and the "exactly one place builds it" assertion fails naming the count.
  const inbox = readFileSync(join(HERE, 'inbox.js'), 'utf8');
  const bodyOf = (name) => {
    const start = inbox.indexOf(`function ${name}(p) {`);
    expect(start).toBeGreaterThan(-1);
    const next = inbox.indexOf('\nfunction ', start + 1);
    return inbox.slice(start, next === -1 ? inbox.length : next);
  };

  it('both renderers emit the chip', () => {
    expect(bodyOf('renderProjectCard')).toMatch(/\$\{fyChipHtml\(p\)\}/);
    expect(bodyOf('renderProjectListRow')).toMatch(/\$\{fyChipHtml\(p\)\}/);
  });

  it('exactly one place builds it, and it asks projectFiscalYear', () => {
    expect(inbox.match(/projects-fy-mini/g) || []).toHaveLength(1);
    expect(bodyOf('fyChipHtml')).toMatch(/projectFiscalYear\(p\)/);
  });

  it('the PUBLIC mirror gets the year without the internal ย้ายเอง marker', () => {
    // index.js enterCustomerView() calls the SAME renderInbox, so every row
    // built here is also a public page. `ย้ายเอง` answers a question only the
    // two desks have.
    expect(bodyOf('fyChipHtml')).toMatch(/!customerMode\s*&&\s*isFiscalYearMoved\(p\)/);
  });

  it('the moved case is distinguishable, not just a year', () => {
    // A ย้ายเอง year is a fact the created_at cannot tell you, so it has to
    // survive the filter being pinned to that same year.
    expect(bodyOf('fyChipHtml')).toMatch(/isFiscalYearMoved\(p\)/);
    expect(bodyOf('fyChipHtml')).toMatch(/ย้ายเอง/);
  });

  it('the class has a rule — a class no stylesheet matches is invisible in review', () => {
    const css = readFileSync(join(HERE, '../../css/projects.css'), 'utf8');
    expect(css).toMatch(/\.projects-fy-mini\s*\{/);
    expect(css).toMatch(/\.projects-fy-mini\.is-moved\s*\{/);
  });

  it('the list row name cell has a WIDTH FLOOR, so a new cell cannot crush it', () => {
    // MEASURED, not theorised. Every other cell in .projects-list-row is
    // `flex: 0 0 auto`, so each one takes its width out of the name cell —
    // and a Thai name breaks at ANY character (`overflow-wrap: anywhere`),
    // so min-width:0 let it collapse to one character per line instead of
    // to an ellipsis. Adding this chip to a row that already carried a
    // badge measured name 0px / row height 702px at a 390px viewport.
    // Through stripComments, because the rule's own comment EXPLAINS the bug
    // and names `min-width:0` — a guard read on raw text fails on the prose
    // describing what it forbids (the exact shape `confirm-modal.test.js`
    // was caught by). Never hand-roll the block-comment regex here.
    const css = stripComments(readFileSync(join(HERE, '../../css/projects.css'), 'utf8'));
    const block = css.match(/\.projects-list-name-wrap\s*\{[^}]*\}/)[0];
    expect(block).toMatch(/min-width:\s*[0-9.]+(rem|px|em)/);
    expect(block).not.toMatch(/min-width:\s*0[;\s]/);
  });
});

// ── §4 the ratchet ──────────────────────────────────────────────────────────
//
// Reintroduce-the-bug check for this guard: paste `d.getFullYear() + 543`
// back into inbox.js and this test fails naming that file.

describe('§4 ONE implementation of the ปีงบ arithmetic', () => {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'fiscal-year.js')
    .map((f) => [f, readFileSync(join(HERE, f), 'utf8')]);

  it('has files to read (a guard whose subject is empty proves nothing)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // WHAT THIS ASSERTS, and why it is not just `/543/`.
  //
  // The first draft flagged any `+ 543` and immediately named data.js —
  // correctly finding `fmtDate`, which converts ค.ศ.→พ.ศ. to PRINT a date
  // and has nothing to do with the budget year. A guard that fires on a
  // correct line gets suppressed, and then it guards nothing
  // (docs/mistakes/tooling-proofs.md).
  //
  // The fiscal derivation is the พ.ศ. offset TOGETHER WITH a month
  // COMPARISON — that pairing is the rule, and `fmtDate` has only the
  // first half (it indexes THAI_MONTHS with getMonth(), never compares it).
  it('no projects module pairs the พ.ศ. offset with a month rollover', () => {
    const offenders = files
      .filter(([, src]) => /\+\s*543\b/.test(src) && /getMonth\(\)\s*[<>]/.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('no projects module hardcodes the ต.ค. rollover month', () => {
    const offenders = files
      .filter(([, src]) => /getMonth\(\)\s*(>=\s*9|>\s*8)\b/.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('inbox.js reads the year through the module, not from created_at directly', () => {
    // The filter, the chip counts and the grid must all ask the same
    // question. Before 0165 the filter compared a locally-derived year to
    // `p.created_at`, which an override could never reach.
    const inbox = readFileSync(join(HERE, 'inbox.js'), 'utf8');
    expect(inbox).toMatch(/projectFiscalYear\(p\)/);
    expect(inbox).not.toMatch(/fiscalYearBE\(p\.created_at\)/);
  });
});

// ── §5 the SQL↔JS mirror ────────────────────────────────────────────────────

describe('§5 the stored shapes match the DB CHECK constraint', () => {
  const sql = readFileSync(
    join(HERE, '../../../supabase/migrations/0165_a_project_year_can_be_moved_and_a_default_chosen.sql'),
    'utf8',
  );

  it('the migration accepts exactly the values isValidDefaultFY() does', () => {
    expect(sql).toMatch(/default_fiscal_year in \('all', 'current'\)/);
    expect(sql).toMatch(/default_fiscal_year ~ '\^\[0-9\]\{4\}\$'/);
    expect(isValidDefaultFY(DEFAULT_FY_ALL)).toBe(true);
    expect(isValidDefaultFY(DEFAULT_FY_CURRENT)).toBe(true);
  });

  it('the override column has a range CHECK, and moveTargetYears stays inside it', () => {
    const m = sql.match(/fiscal_year_be between (\d+) and (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBe(2500);
    expect(Number(m[2])).toBe(2700);
  });

  it('the prefs table is GRANTed, not just policied — a policy with no grant denies everyone (0138)', () => {
    expect(sql).toMatch(/grant select, insert, update, delete on public\.project_user_prefs to authenticated/);
  });

  it('the UPDATE policy has BOTH halves — USING alone lets a row be moved onto another uid', () => {
    const upd = sql.match(/create policy project_user_prefs_update[\s\S]*?;/);
    expect(upd).toBeTruthy();
    expect(upd[0]).toMatch(/using \(user_id = auth\.uid\(\)\)/);
    expect(upd[0]).toMatch(/with check \(user_id = auth\.uid\(\)\)/);
  });
});

// §6 NOTHING BACKFILLS fiscal_year_be. NULL means "ask the clock" (this
// module's header), so a migration that fills the NULL rows from the date
// freezes them: a corrected created_at never re-derives again (0128's
// cohort_year — fill-once means never-correct). 0223's draft did exactly
// that for 36 rows; the review removed it. The only legal writer is a human
// moving a โครงการ, through the app.
describe('§6 no migration backfills fiscal_year_be', () => {
  const dir = join(HERE, '../../../supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));

  it('reads the migrations (control: the column exists in some of them)', () => {
    const all = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(all).toMatch(/fiscal_year_be/);
  });

  it('no UPDATE of public.projects sets fiscal_year_be', () => {
    const offenders = files.filter((f) => {
      const sql = readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '');
      return /update\s+public\.projects\b[^;]*\bset\b[^;]*\bfiscal_year_be\s*=/i.test(sql);
    });
    expect(offenders).toEqual([]);
  });
});
