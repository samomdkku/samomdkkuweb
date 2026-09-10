// The Drive sweep's REPORT must never claim more than it examined.
//
// WHY THIS FILE EXISTS. `tools/proj0183-drive-orphans.mjs` had three separate
// reporting bugs in one afternoon, and every one of them shipped green:
//
//   1. `--rows-only` printed "✓ Drive files with NO database row: 0" for a half
//      it never ran, then "✓ Drive and the database agree, in both directions."
//      A false clean bill of health, from the tool whose own header says
//      "'no orphans' and 'the listing failed' must never render the same".
//   2. The fix for (1) threw `ReferenceError: Cannot access 'didRows' before
//      initialization` on the next real run — declared after its first use.
//      `node --check` said "syntax OK" and `npm test` was green, because
//      NOTHING IN THE SUITE RAN THE FILE. A parse check is not a run.
//   3. `--folders-only` could never work at all: it skips the stat pass, and
//      the folder listing picked its `knownFileId` only from rows that pass
//      CONFIRMED, so it listed nothing and tripped its own control every time.
//      And `unanswered`, derived from that skipped pass, still counted toward
//      the total — so the verdict said "3 finding(s)" above three lines
//      reading NOT EXAMINED.
//
// The tool talks to production Supabase and a public Apps Script endpoint, so it
// cannot be run in a test. `SELFTEST=1` makes it skip both, feed the reporting
// block synthetic data — ONE finding in each direction, so formatters are
// exercised with content and not only with zeros — and print. That runs in
// milliseconds and would have caught all three.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../../../tools/proj0183-drive-orphans.mjs', import.meta.url));

/** Run the sweep in self-test mode. Never throws on exit 1, which is the
 *  tool's "there are findings" code and the normal case here. */
function run(...args) {
  try {
    return execFileSync('node', [TOOL, ...args], {
      env: { ...process.env, SELFTEST: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // A ReferenceError lands here too — so assert on the TEXT, never on the
    // exit code alone. Bug (2) exited non-zero exactly like a findings run.
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
}

const BOTH = run();
const ROWS = run('--rows-only');
const FOLDERS = run('--folders-only');

describe('the sweep runs at all — a parse check is not a run', () => {
  for (const [name, out] of [['both', BOTH], ['--rows-only', ROWS], ['--folders-only', FOLDERS]]) {
    it(`${name} does not crash`, () => {
      expect(out).not.toMatch(/ReferenceError|TypeError|is not a function|Cannot access/);
      expect(out).toContain('── examined');
    });
  }
});

describe('a skipped half is reported as skipped, never as zero', () => {
  it('--rows-only says SKIPPED for folders and NOT EXAMINED for their findings', () => {
    expect(ROWS).toContain('folders: SKIPPED');
    expect(ROWS).toMatch(/Drive files with NO database row.*NOT EXAMINED/);
    // The exact false claim that started this: a zero for the un-run half.
    expect(ROWS).not.toMatch(/✓ Drive files with NO database row[^\n]*: 0/);
  });

  it('--folders-only says SKIPPED for rows and NOT EXAMINED for their findings', () => {
    expect(FOLDERS).toContain('rows: SKIPPED');
    expect(FOLDERS).toMatch(/rows whose file no longer resolves.*NOT EXAMINED/);
    expect(FOLDERS).not.toMatch(/✓ rows whose file is TRASHED[^\n]*: 0/);
  });

  it('the verdict names which directions ran, and warns when one did not', () => {
    expect(BOTH).toContain('both directions');
    expect(ROWS).toContain('--rows-only');
    expect(ROWS).toMatch(/THE OTHER DIRECTION WAS NOT EXAMINED|read them above \(database → Drive ONLY/);
    expect(FOLDERS).toContain('--folders-only');
    // Neither single-direction run may ever claim the pair.
    expect(ROWS).not.toContain('agree — both directions');
    expect(FOLDERS).not.toContain('agree — both directions');
  });
});

describe('both single-direction flags actually examine something', () => {
  // Bug (3): --folders-only listed 0 of N and failed its own control, which is
  // indistinguishable from a broken listing call. A flag that cannot work is
  // worse than a flag that does not exist.
  it('--folders-only lists its folders instead of tripping the control', () => {
    expect(FOLDERS).not.toContain('CONTROL FAILED');
    expect(FOLDERS).toMatch(/1\/1 folders listed/);
  });

  it('--rows-only stats its rows', () => {
    expect(ROWS).not.toContain('CONTROL FAILED');
    expect(ROWS).toMatch(/2\/2 rows stat'd/);
  });
});

describe('the finding COUNT agrees with the lines it summarises', () => {
  // Bug (3), second half: `unanswered` came from the skipped stat pass and was
  // still counted, so the number contradicted the list above it. A count that
  // disagrees with its own list is worse than either alone.
  const countOf = (out) => Number(out.match(/⚠ (\d+) finding\(s\)/)?.[1] ?? -1);

  it('both directions: the synthetic orphan AND the missing row', () => {
    expect(countOf(BOTH)).toBe(2);
  });

  it('--rows-only counts ONLY the row-side finding', () => {
    expect(countOf(ROWS)).toBe(1);
  });

  it('--folders-only counts ONLY the folder-side finding', () => {
    expect(countOf(FOLDERS)).toBe(1);
  });

  it('every findings key belongs to exactly one direction', () => {
    // The tool fails loudly if a key belongs to neither list, so a new finding
    // cannot be added and silently left out of the total. Prove that guard is
    // reachable rather than trusting the partition.
    for (const out of [BOTH, ROWS, FOLDERS]) {
      expect(out).not.toContain('belongs to neither direction');
    }
  });
});

describe('the self-test really does bypass the network', () => {
  it('names no live project and makes no GAS call', () => {
    // If SELFTEST ever stopped stubbing, this suite would start hitting
    // production Supabase and a public webhook from CI. The tell is the pace:
    // a real run of two batches cannot finish in the time a test allows.
    expect(BOTH).toContain('read-only: this tool never writes');
    expect(BOTH).toMatch(/2 Drive-backed rows across 1 หนังสือ/);
  });
});
