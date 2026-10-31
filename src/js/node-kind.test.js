// ==============================================
// TWO KINDS, AND NOTHING MAY QUIETLY WRITE A THIRD.
//
// `team_nodes.kind` is plain `text` with no check constraint and a default of
// 'role' — the database will accept any string at all and never complain. That
// is how three kinds became a live tree where 78 of 298 nodes carried a value
// (`department`) that nothing read and that half the tree disagreed about.
//
// Now the value DECIDES things — sibling order and the "แสดงถึง" rungs on the
// public chart (org-rung.js) — so a writer that emits an unknown kind no longer
// just picks the wrong icon: the node sorts as a ตำแหน่ง, and at the ฝ่าย rungs
// it disappears along with everything under it. Silently, on the public page.
//
// So this guard covers the WRITERS, in both languages the app writes in: the
// <select> a human picks from, and the JS literals the importers assign.
//
// TO CHECK IT GUARDS: put `<option value="department">แผนก</option>` back into
// the select in tab-team.html, or change ensurePath's middle-segment kind back
// to 'department', and watch the matching assertion fail. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';
import { NODE_KINDS, isDivision, normalizeKind } from './node-kind.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('the vocabulary itself', () => {
  it('is exactly ฝ่าย and ตำแหน่ง', () => {
    expect(NODE_KINDS).toEqual(['division', 'role']);
  });

  it('READS the retired `department` as a ฝ่าย', () => {
    // Lenient on read, on purpose: a browser on the previous bundle, an export
    // taken before migration 0151, a hand-edited import file. An unrecognised
    // kind falls through to ตำแหน่ง, which for a CONTAINER is the wrong answer
    // in both the sort and the rungs — so this fallback is load-bearing, not
    // tidiness. Do not delete it because the live table no longer has any.
    expect(isDivision('department')).toBe(true);
    expect(normalizeKind('department')).toBe('division');
  });

  it('WRITES only the two', () => {
    for (const input of ['department', 'unit', '', null, undefined, 'DIVISION']) {
      expect(NODE_KINDS).toContain(normalizeKind(input));
    }
    expect(normalizeKind('division')).toBe('division');
    expect(normalizeKind('role')).toBe('role');
  });
});

describe('the ประเภท picker offers exactly the two kinds', () => {
  const html = read('../html/tab-team.html');

  it('#teamNodeKind has one <option> per kind and no others', () => {
    const sel = html.slice(html.indexOf('id="teamNodeKind"'));
    const block = sel.slice(0, sel.indexOf('</select>'));
    const values = [...block.matchAll(/<option\s+value="([^"]*)"/g)].map((m) => m[1]);
    expect(values.length, 'the control found no options at all').toBeGreaterThan(0);
    expect(values.sort()).toEqual([...NODE_KINDS].sort());
  });
});

describe('no writer emits a kind outside the vocabulary', () => {
  // Only the files that write `team_nodes.kind`. Scoping matters: "department"
  // is a live word elsewhere in this app (PR ฝ่าย, VitalSound แผนก, passport
  // departments), and a repo-wide grep would be noise nobody reads.
  const WRITERS = ['./team/index.js', './team/io.js', './org-chart.js',
    './org-rung.js', './node-kind.js'];
  // A QUOTED literal, so `x.department_id` and '/rpc/list_passport_departments'
  // — both live, both unrelated — do not register.
  const RETIRED = /(['"`])department\1/g;
  const LIVE = /(['"`])(division|role)\1/g;
  const scan = (src, re) => [...stripComments(src).matchAll(re)].map((m) => m[0]);

  it.each(WRITERS)('%s writes no retired kind literal', (rel) => {
    // node-kind.js is the ONE place allowed to name it — that is where the
    // lenient read lives. Everywhere else it is a writer emitting a dead value.
    const allowed = rel === './node-kind.js';
    const found = scan(read(rel), RETIRED);
    expect(found.length, `${rel} names 'department'`).toBe(allowed ? found.length : 0);
  });

  it('the scanner is reading these files, and can see a kind literal in them', () => {
    // THE CONTROL. "Zero occurrences of `department`" is worth nothing until
    // the same reader has proved it finds the kinds that ARE there — a wrong
    // path, a broken stripper or a regex that matches nothing all print zero.
    const seen = WRITERS.flatMap((rel) => scan(read(rel), LIVE));
    expect(seen.length, 'the scanner found no kind literal in ANY writer').toBeGreaterThan(0);
  });

  it('the scanner would catch a reintroduced `department`', () => {
    // The control for the control — the exact form the bug took, in the file it
    // took it in (ensurePath, the CSV path importer).
    const sample = "const kind = i === 0 ? 'division' : 'department';";
    expect(scan(sample, RETIRED)).toHaveLength(1);
  });
});
