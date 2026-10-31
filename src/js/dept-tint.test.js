// ==============================================
// A TINT NAME WITH NO --dept-* BEHIND IT DISAPPEARS, SILENTLY.
//
// The ทีม SAMO admin tree sets `--node-tint: var(--dept-<name>)` on each root
// ฝ่าย and the whole subtree inherits it — the bar, the band and the guide
// rails are all drawn from that one property. If the custom property does not
// exist, `var()` resolves to nothing: no error, no console warning, no failed
// request. The bar is simply not painted, and a tree with no bars looks like a
// design decision rather than a typo.
//
// That is `.claude/rules/mistakes.md` class 6 in its CSS form — "a class in the
// markup with NO rule in any stylesheet is invisible in review" — and this repo
// has paid for it more than once.
//
// The subject is DERIVED from the table (TINT_NAMES), not listed again here, so
// a tint added tomorrow is checked tomorrow without anyone remembering to.
//
// TO CHECK IT GUARDS: add `[/ทดสอบ/, 'nosuchtint']` to DEPT_TINT in
// dept-tint.js and watch this fail naming it. Then remove it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TINT_NAMES, tintFor, tintColor, isHexColor } from './dept-tint.js';

const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

describe('every tint the table can return exists in base.css', () => {
  it('has a --dept-<name> custom property for each', () => {
    expect(TINT_NAMES.length, 'the table returned no tints at all').toBeGreaterThan(0);
    const missing = TINT_NAMES.filter((t) => !new RegExp(`--dept-${t}\\s*:`).test(base));
    expect(missing, `no --dept-* in base.css for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the control: the scanner would notice one that is absent', () => {
    // "Zero missing" is only evidence once the same test has been shown to find
    // a missing one. Otherwise a broken path or a bad regex prints zero too.
    expect(new RegExp('--dept-nosuchtint\\s*:').test(base)).toBe(false);
    expect(new RegExp('--dept-digital\\s*:').test(base)).toBe(true);
  });
});

describe('the table is shared, so both surfaces agree', () => {
  it('matches the real ฝ่าย names the tree carries', () => {
    // Named subjects rot (class 4 of the guard playbook), so these are the
    // stable stems the regexes are actually written against, not full titles
    // copied out of the live tree.
    expect(tintFor('ฝ่ายดิจิทัลและสื่อสารองค์กร')).toBe('digital');
    expect(tintFor('ฝ่ายวิชาการ')).toBe('academic');
    expect(tintFor('สำนักนายกฯ')).toBe('admin');
  });

  it('returns null for a ฝ่าย the palette has none for', () => {
    // 15 roots, 10 colours — this path is normal. Both consumers fall back to
    // the brand green, so it must be a clean null rather than undefined or ''.
    expect(tintFor('เอิงtesting')).toBeNull();
    expect(tintFor('')).toBeNull();
    expect(tintFor(null)).toBeNull();
  });
});

describe('the JS hex check and the SQL CHECK are one rule in two places', () => {
  // 0152 constrains team_nodes.color in the database AND isHexColor() guards the
  // same value on the way into a `style` attribute. Two implementations of one
  // rule is `.claude/rules/mistakes.md` class 6, and the mitigation is the
  // differential test written in the same commit — the regex is read out of the
  // migration rather than retyped, so the two cannot drift without this failing.
  const sql = readFileSync(
    new URL('../../supabase/migrations/0152_a_faai_can_choose_its_colour.sql', import.meta.url),
    'utf8',
  );
  const m = sql.match(/color\s*~\s*'(\^[^']+)'/);

  it('the migration still carries a hex pattern this test can read', () => {
    // The instrument, checked before it is trusted: a renamed migration or a
    // rewritten constraint would otherwise leave the differential below
    // comparing against nothing and passing.
    expect(m, 'no `color ~ \'…\'` CHECK found in 0152').toBeTruthy();
  });

  it('agrees with the database on every case, accept AND refuse', () => {
    const pg = new RegExp(m[1].replace(/\{(\d)\}/g, '{$1}'));
    const cases = [
      '#abc', '#ABC', '#105922', '#F2CB67', '#10592280',
      'red', '', '#', '#ab', '#abcd', '#abcde', '#12345g',
      '#fff;background:url(//x)', 'var(--dept-digital)', 'rgb(1,2,3)',
    ];
    const disagree = cases.filter((c) => pg.test(c) !== isHexColor(c));
    expect(disagree, `JS and SQL disagree on: ${disagree.join(', ')}`).toEqual([]);
    // The control: the case list must actually contain both verdicts, or
    // "they agree" would be true of two functions that always say no.
    expect(cases.some(isHexColor)).toBe(true);
    expect(cases.some((c) => !isHexColor(c))).toBe(true);
  });

  it('rejects a non-string without throwing', () => {
    for (const v of [null, undefined, 42, {}, ['#abc']]) expect(isHexColor(v)).toBe(false);
  });
});

describe('tintColor: chosen beats derived, and derived is ROOT-ONLY', () => {
  const ROOT = true;

  it('uses the admin\'s colour when there is one, at any depth', () => {
    expect(tintColor({ name: 'ฝ่ายวิชาการ', color: '#F2CB67' }, ROOT)).toBe('#F2CB67');
    expect(tintColor({ name: 'ฝ่ายอะไรก็ได้', color: '#F2CB67' }, false)).toBe('#F2CB67');
  });

  it('falls back to the name AT A ROOT', () => {
    expect(tintColor({ name: 'ฝ่ายวิชาการ', color: null }, ROOT)).toBe('var(--dept-academic)');
  });

  it('a NON-ROOT ฝ่ายวิชาการ inherits instead of matching its own name', () => {
    // THE REPORT: "ฝ่ายวิชาการ that is inside ฝ่ายรังสีเทคนิค shows different
    // color". The name match is a guess standing in for an identity nobody
    // recorded; inside a branch there IS something to inherit, so the guess
    // must lose. Measured: 29 non-root nodes match the palette by name, and
    // ฝ่ายวิชาการ sits under BOTH ฝ่ายรังสีเทคนิค and ฝ่ายเวชนิทัศน์.
    expect(tintColor({ name: 'ฝ่ายวิชาการ', color: null }, false)).toBeNull();
    // The coincidental ones too — these painted the right answer for the wrong
    // reason and are why the bug survived review.
    expect(tintColor({ name: 'อุปนายกฝ่ายบริหารองค์กร' }, false)).toBeNull();
  });

  it('ignores a stored value that is not a hex literal', () => {
    // Defence in depth against the projection ever carrying something else:
    // this string would land inside `style="--org-tint: …"` on a public page.
    expect(tintColor({ name: 'ฝ่ายวิชาการ', color: 'red;x:url(//e)' }, ROOT))
      .toBe('var(--dept-academic)');
  });

  it('returns null when neither source has an answer', () => {
    expect(tintColor({ name: 'เอิงtesting' }, ROOT)).toBeNull();
    expect(tintColor(null, ROOT)).toBeNull();
  });

  it('every caller passes the root flag — a default of true would re-open it', () => {
    // The signature defaults isRoot to FALSE, so a caller that forgets the
    // argument inherits (safe) rather than guessing (the bug). This asserts
    // every real call site still says which it is, because a silent
    // `tintColor(node)` in a tree renderer is exactly how this came back.
    const sites = ['./team/index.js', './org-chart.js']
      .map((rel) => readFileSync(new URL(rel, import.meta.url), 'utf8'))
      .flatMap((src) => [...src.matchAll(/tintColor\(([^)]*)\)/g)].map((m) => m[1]));
    // A FLOOR, not an equality. This was `toBe(3)`, and adding a legitimate
    // fourth call site (ผังสายงาน's lineBlock, 2026-08-25) turned it red for a
    // reason that had nothing to do with the rule it guards — the same
    // "its SUBJECT is a hardcoded value that rotted" shape the proofs keep
    // hitting. The count is only here so a sweep that finds NOTHING cannot
    // report green; the loop below is the actual assertion, and it gets
    // stronger with each call site rather than needing to be edited.
    expect(sites.length, 'no tintColor call sites found at all').toBeGreaterThanOrEqual(3);
    for (const args of sites) {
      expect(args, `tintColor(${args}) does not say whether it is a root`)
        .toMatch(/,/);
    }
  });
});
