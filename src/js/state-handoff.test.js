// state-handoff.test.js — the handoff must not name something that is not there.
//
// WHY THIS EXISTS. STATE.md is the first thing every session reads, and it is
// the one file whose whole value is being TRUE. On 2026-08-26 a single audit of
// it found six stale claims, and five shared one shape:
//
//   the same fact lived in TWO places, and only ONE was corrected.
//
//   · the context budget: one paragraph said "29,725 of 30,000, the next
//     write-up may turn `npm test` red", four hundred lines below a paragraph
//     saying that exact claim was false and had been deleted;
//   · `claude0157` was called RED in three places and had been green for a day;
//   · the test count read 1309 in one place and 1312 in another;
//   · "still owed: grant the `claude` permission" sat above a section recording
//     it as granted eight days earlier;
//   · the deployed sha named a commit two deploys behind, which reads exactly
//     like "there is a deploy owed" and costs a VPN session to disprove.
//
// A file that contradicts itself is worse than a file that is silent: the reader
// cannot tell which half to trust, so they re-derive the work anyway, which is
// the one thing the handoff exists to prevent.
//
// WHAT THIS CAN AND CANNOT DO. It cannot judge whether a sentence is TRUE —
// "claude0157 is red" is a claim about the world and no offline test can settle
// it. What it can do is pin the claims that are mechanically checkable, and
// insist the file agree with the repository and with ITSELF. The rest is the
// standing rule, which belongs in prose because it is a habit:
//
//   ⛔ WHEN YOU CORRECT A CLAIM IN STATE.md, GREP THE WHOLE FILE FOR ITS OTHER
//      HOMES BEFORE YOU COMMIT. Every one of the five above was one grep away.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const STATE = readFileSync(join(ROOT, 'STATE.md'), 'utf8');

/**
 * Backticked strings STATE.md names that LOOK like a file in this repo.
 *
 * The `/` requirement is what keeps served bundle hashes out — `public-*.js` is
 * recorded as EVIDENCE of a past deploy, not as a file anyone can open, and a
 * guard that demanded those exist would be wrong on purpose.
 */
function namedPaths(md) {
  const out = new Set();
  for (const m of md.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    if (t.includes('/') && /^[\w./-]+\.(md|js|sql|mjs|sh|conf|html|css|json|gs|py)$/.test(t)) out.add(t);
  }
  return [...out].sort();
}

/**
 * Named, but deliberately absent. Each entry must say WHY — an unexplained
 * exemption is how a real broken pointer gets parked here and forgotten.
 */
const ABSENT_ON_PURPOSE = {
  '.claude/rules/mistakes-archive.md':
    'deleted; STATE.md names it only to say "do not re-create it" — it lived in the auto-loaded directory, so archiving into it saved nothing',
  'docs/state-archive/YYYY-MM-DD.md':
    'a filename PATTERN for the archive convention, not a file',
  'scratchpad/disprove.mjs':
    'an ephemeral ~30-line WebKit harness; STATE.md names it as a SHAPE worth rebuilding and says so',
  'assets/admin-CPiyOZWb.js':
    'a served bundle hash from a past deploy, recorded as evidence; it has a slash only because the URL path does',
  'externaldata/house-import/2026-09-14-teamsamo-no-kkumail.md':
    'gitignored local artifact under externaldata/ — the raw handover files and their derived lists never enter git (1,776 real students\' data); phuriphatma.md names it as evidence for a specific session, not a repo file',
  'externaldata/house-import/house0196-snapshot.json':
    'same as above — a gitignored pre-migration snapshot, named for the record',
  'public/passport-elsewhere.html':
    'DELETED 2026-09-04 by the repo merge, permanently. It was the splash telling a preview visitor Passport was not in this build; passport is now built into dist/passport/ so the path it apologised for exists. Named only by docs/state/phuriphatma.md, which is one person\'s session notes and is never rewritten by anyone else — hence an exemption rather than an edit. This file is not coming back: a rule sending /passport/* anywhere but the real files is the bug the merge removed.',
};

describe('STATE.md is a handoff, not a memory', () => {
  it('reads the file at all (a sweep that finds nothing must prove it looked)', () => {
    expect(STATE.length).toBeGreaterThan(4000);
    expect(namedPaths(STATE).length).toBeGreaterThan(10);
  });

  // This floor used to be 20,000 bytes, which was not a sanity check — it was a
  // description of the bloat the file had at the time, and it would have gone
  // red on the split that FIXED the problem. The ceiling below is the real
  // rule, and it is the one CLAUDE.md states.
  it('stays a status file — under ~200 lines', () => {
    const lines = STATE.split('\n').length;
    expect(lines, [
      `STATE.md is ${lines} lines; the rule in CLAUDE.md is ~200.`,
      'It grew back because someone appended instead of routing. Where it goes:',
      '  a rule that outlives the session  → docs/INVARIANTS.md',
      '  what your session did             → docs/state/<handle>.md',
      '  why it was done that way          → docs/state-archive/YYYY-MM-DD.md',
      'Prune the OLDEST block, and only after opening the write-up it points to.',
    ].join('\n')).toBeLessThan(260);
  });

  // §6.5: the same dead-pointer sweep over every file the split created.
  it('the split files name no file that is not there either', () => {
    const extra = ['docs/INVARIANTS.md'];
    if (existsSync(join(ROOT, 'docs/state'))) {
      for (const f of readdirSync(join(ROOT, 'docs/state'))) {
        if (f.endsWith('.md')) extra.push(`docs/state/${f}`);
      }
    }
    const broken = [];
    for (const rel of extra) {
      const md = readFileSync(join(ROOT, rel), 'utf8');
      for (const t of namedPaths(md)) {
        if (t in ABSENT_ON_PURPOSE) continue;
        if (!existsSync(join(ROOT, t)) && !existsSync(join(ROOT, 'src/js', t))) {
          broken.push(`${rel} → ${t}`);
        }
      }
    }
    expect(broken, [
      'A split file points at something that is not there. The split moved these',
      'lines out of STATE.md, so a pointer that was relative to it may now be',
      'wrong — fix the path, or add it to ABSENT_ON_PURPOSE with the reason.',
    ].join('\n')).toEqual([]);
  });

  it('names no file that is not there', () => {
    const broken = namedPaths(STATE).filter((p) => {
      if (p in ABSENT_ON_PURPOSE) return false;
      // Module paths are often written relative to src/js — `team/index.js`
      // means `src/js/team/index.js`. Both spellings resolve.
      return !existsSync(join(ROOT, p)) && !existsSync(join(ROOT, 'src/js', p));
    });
    expect(broken, [
      'STATE.md points at files that do not exist. A cold session follows these',
      'pointers first, and a dead one costs more than the sentence saved.',
      'Fix the path, or add it to ABSENT_ON_PURPOSE with the reason.',
    ].join('\n')).toEqual([]);
  });

  it('every exemption gives a reason', () => {
    for (const [p, why] of Object.entries(ABSENT_ON_PURPOSE)) {
      expect(typeof why === 'string' && why.length > 30,
        `${p}: an exemption needs a written reason, not a placeholder`).toBe(true);
    }
  });

  // An exemption is a claim about the world, and unlike "claude0157 is red"
  // this one IS checkable. `src/html/tab-golden-period.html` was exempted as
  // "PLANNED, not written — DELETE this exemption in the same commit that
  // creates the file". The file was created on 2026-08-27 and the exemption
  // stayed, so for every day after that the dead-pointer sweep SKIPPED a real
  // file: rename or delete it and both sweeps above would have stayed green
  // while STATE.md pointed at nothing. A guard fails GREEN when its exemption
  // list outlives the absence it describes.
  it('no exemption survives the file arriving', () => {
    const arrived = Object.keys(ABSENT_ON_PURPOSE).filter(
      (p) => existsSync(join(ROOT, p)) || existsSync(join(ROOT, 'src/js', p)),
    );
    expect(arrived, [
      'These paths are listed as ABSENT_ON_PURPOSE but exist on disk.',
      'An exemption for a file that is THERE is not an exemption — it is a hole:',
      'the dead-pointer sweep skips that path, so a later rename goes unnoticed.',
      'Delete the entry.',
    ].join('\n')).toEqual([]);
  });

  it('its "migrations through NNNN" matches the migrations on disk', () => {
    const claimed = [...STATE.matchAll(/Migrations through \*{0,2}(\d{4})\*{0,2}/gi)].map((m) => m[1]);
    expect(claimed.length, 'STATE.md no longer states a migration high-water mark').toBeGreaterThan(0);

    const onDisk = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 4))
      .sort()
      .pop();

    // EVERY spelling, not just the first: the whole point is that a fact with
    // two homes gets corrected in one of them.
    for (const c of claimed) {
      expect(c, `STATE.md says migrations through ${c}; the highest on disk is ${onDisk}`).toBe(onDisk);
    }
    expect(new Set(claimed).size, 'STATE.md states two different migration numbers').toBe(1);
  });

  it('its live-proof count matches what npm run proofs actually runs', () => {
    const runner = readFileSync(join(ROOT, 'tools/run-proofs.mjs'), 'utf8');
    // The runner is itself invoked through db-query.mjs, which is not a proof.
    const registered = new Set(
      [...runner.matchAll(/['"]([\w-]+\.(?:sql|mjs))['"]/g)].map((m) => m[1]),
    );
    registered.delete('db-query.mjs');

    // Two accepted shapes, and the second one matters: "ALL n" was the only
    // form this accepted until 2026-09-05, which meant the guard structurally
    // FORBADE recording a red proof — the honest sentence "30 of 32 green" made
    // the count vanish and the test fail. A handoff guard that only permits
    // good news trains people to write good news. What is checked is the TOTAL;
    // how many are passing is a claim no offline test can settle.
    const claimed = [
      ...[...STATE.matchAll(/(?:ALL |all )(\d+)(?: LIVE)? [Pp][Rr][Oo][Oo][Ff][Ss]/g)]
        .map((m) => Number(m[1])),
      ...[...STATE.matchAll(/\d+\s+of\s+(\d+)(?: LIVE)? [Pp][Rr][Oo][Oo][Ff][Ss]/g)]
        .map((m) => Number(m[1])),
    ];
    expect(claimed.length, 'STATE.md no longer states a proof count').toBeGreaterThan(0);
    for (const c of claimed) {
      expect(c, `STATE.md claims ${c} proofs; run-proofs.mjs registers ${registered.size}`)
        .toBe(registered.size);
    }
  });

  // A test COUNT has no authority to check it against — `it()` occurrences
  // under-count loop-generated cases badly, so a static check would fire on the
  // healthy file. The migration high-water mark and the proof count DO have
  // authorities (the directory, and run-proofs.mjs), and are checked above.
  //
  // So this asserts only that the count is not stated TWICE differently, and
  // permits it to be absent. On 2026-08-28 STATE.md said "1323 tests" when the
  // suite ran 1355: single-homed, guarded, and wrong. A number nothing can
  // verify is better replaced by the command that produces it.
  // ── THE DEPLOYED SHA ────────────────────────────────────────────────────
  //
  // The header of this file already records that a stale deployed sha "reads
  // exactly like there is a deploy owed and costs a VPN session to disprove".
  // It happened AGAIN on 2026-08-28, in a worse shape: the ✅ DEPLOYED line was
  // correctly updated to `2151d6a`, while the file's own two "check, do not
  // trust this line" commands and its closing paragraph still read
  // `git diff --stat 7405712..HEAD`. Four homes, one corrected — and this time
  // the stale copy was the INSTRUMENT. Running what the file told you to run
  // reported 132 insertions of already-shipped code.
  //
  // Checking that the copies AGREE would be the weak guard: it leaves the
  // retyping in place and only notices after someone forgets. So this forbids
  // the SHAPE. The sha lives in exactly one line, and the verification command
  // reads it from there — `npm run deploy:owed`, which also diffs the WORKING
  // TREE, something `<sha>..HEAD` cannot see.
  it('states the deployed sha exactly once, and never retypes it into a command', () => {
    const declared = [...STATE.matchAll(/DEPLOYED = `([0-9a-f]{7,40})`/g)].map((m) => m[1]);
    expect(declared.length, [
      `STATE.md marks ${declared.length} deployed shas${declared.length ? ` (${declared.join(', ')})` : ''}; there must be exactly 1.`,
      '0 — restore the line: - ✅ **DEPLOYED = `<sha>` (YYYY-MM-DD)**',
      '2+ — that IS the bug: one fact, two homes, and only one of them corrected.',
    ].join('\n')).toBe(1);

    // Any OTHER 7+ hex sha fed to a `git diff ...HEAD` is a retyped copy.
    const retyped = [...STATE.matchAll(/git diff[^\n]*?\b([0-9a-f]{7,40})\.\.HEAD/g)].map((m) => m[1]);
    expect(retyped, [
      'STATE.md hand-writes a deployed sha into a `git diff <sha>..HEAD` command.',
      'That is the copy that rots — on 2026-08-28 two of them were two deploys',
      'behind the ✅ DEPLOYED line and reported an already-shipped deploy as owed.',
      'Use `npm run deploy:owed`; it reads the sha from the DEPLOYED line, which',
      'is its only home, and it can also see uncommitted work.',
    ].join('\n')).toEqual([]);

    // And the one home must resolve. A mistyped sha is silent otherwise.
    const sha = declared[0];
    let resolves = null;
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`],
        { cwd: ROOT, stdio: 'ignore' });
      resolves = true;
    } catch (err) {
      // No git (a tarball, a sandbox) is not a stale handoff — do not fail the
      // healthy case. Only a git that ran and said NO counts.
      resolves = err.code === 'ENOENT' ? null : false;
    }

    // ⚠️ A SHALLOW CLONE ANSWERS "NO" FOR A COMMIT THAT IS PERFECTLY FINE.
    // `actions/checkout` fetches depth 1 by default, so every sha but the tip
    // is absent and `cat-file` reports exactly what a MISTYPED sha reports.
    // This guard therefore failed `main` continuously from 2026-08-28 — first
    // on e0bd2e2, then on f9584e5 — and because `build` is a REQUIRED status
    // check, a false red here blocks every contributor PR. Nobody noticed,
    // because a guard that is always red is indistinguishable from a guard.
    //
    // build.yml now checks out with `fetch-depth: 0` so the guard is real in
    // CI; this second half makes it honest anywhere else. "I cannot see that
    // object" is not "that object does not exist".
    if (resolves === false) {
      let shallow = false;
      try {
        shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'],
          { cwd: ROOT, encoding: 'utf8' }).trim() === 'true';
      } catch { /* no git — already handled above */ }
      if (shallow) resolves = null;
    }
    if (resolves === false) {
      throw new Error(`STATE.md says DEPLOYED = ${sha}, which is not a commit in this repo.`);
    }
  });

  it('does not state two different test counts (and need not state one)', () => {
    const counts = new Set([...STATE.matchAll(/\*\*(\d{3,5}) tests/g)].map((m) => m[1]));
    expect([...counts], 'STATE.md states more than one test count — correct BOTH homes')
      .toHaveLength(counts.size > 0 ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------
// HANDOFF.md — the file that had NO guard, which is where the worst claim lived.
//
// Every check above this line is on STATE.md. docs/state/HANDOFF.md had none,
// and on 2026-09-05 that is exactly where the most expensive wrong sentence in
// the repo was found: §10 explained away nine failing security checks as "a
// probe artefact — the Management API bypasses RLS". Stated as fact, never
// tested, and wrong. Impersonation works fine; the probe's "student" was an
// admin. It sat there for weeks steering readers away from a five-minute
// measurement, and the script's OWN anon block (15/15 passing) contradicted it
// three lines above.
//
// The failure was not carelessness. An explanation and a finding LOOKED
// IDENTICAL on the page, so a reader could not tell which they were holding.
// These tests make the difference structural: every section declares whether it
// is VERIFIED (and how), a HYPOTHESIS, a DECISION, or work still OWED.
const HANDOFF_PATH = join(ROOT, 'docs/state/HANDOFF.md');
const HANDOFF = readFileSync(HANDOFF_PATH, 'utf8');

/** Each `## ` section as { heading, body }. */
function sections(md) {
  const out = [];
  const parts = md.split(/\n(?=## )/);
  for (const p of parts) {
    if (!p.startsWith('## ')) continue;
    const eol = p.indexOf('\n');
    out.push({ heading: p.slice(3, eol === -1 ? undefined : eol).trim(), body: p });
  }
  return out;
}

const STATUS_RE = /^\*\*Status:\s*(VERIFIED|HYPOTHESIS|DECIDED|OWED)\b([^*]*)\*\*(.*)$/m;

describe('HANDOFF.md says how much to trust each section', () => {
  it('reads the file and finds sections (a sweep that finds nothing must prove it looked)', () => {
    expect(HANDOFF.length).toBeGreaterThan(500);
    // The control. Without it, a rename of `## ` to anything else would empty
    // every sweep below and they would all pass on zero sections.
    expect(sections(HANDOFF).length).toBeGreaterThanOrEqual(6);
  });

  it('every section declares a Status', () => {
    const missing = sections(HANDOFF)
      .filter((s) => !/^0\./.test(s.heading))
      .filter((s) => !STATUS_RE.test(s.body))
      .map((s) => s.heading);
    expect(missing, [
      'Every ## section in HANDOFF.md needs a Status line:',
      '  **Status: VERIFIED <date>** — how: <what you ran>',
      '  **Status: HYPOTHESIS**        (a theory nobody has tested)',
      '  **Status: DECIDED <date>**    (the owner chose; do not re-litigate)',
      '  **Status: OWED**              (work not started)',
      '',
      'This exists because an explanation once read exactly like a finding.',
    ].join('\n')).toEqual([]);
  });

  it('a VERIFIED section says HOW it was verified', () => {
    // The whole point. "VERIFIED" with no method is the shape that failed —
    // a confident sentence with nothing behind it. `how:` must name something
    // a reader can re-run or re-observe.
    const bad = [];
    for (const s of sections(HANDOFF)) {
      const m = s.body.match(STATUS_RE);
      if (!m || m[1] !== 'VERIFIED') continue;
      const tail = `${m[2]} ${m[3]}`;
      if (!/how:\s*\S/i.test(tail)) bad.push(s.heading);
    }
    expect(bad, 'A VERIFIED section must carry "— how: <what was run/observed>".')
      .toEqual([]);
  });

  it('does not restate the deployed sha — STATE.md is its one home', () => {
    // mistakes.md class 6: a decaying fact with two homes gets corrected in one.
    // The deployed sha already did this once, and the stale copy was inside the
    // very command that was supposed to check it.
    // A git sha is hex, but so is a pure-decimal id — the Discord APP ID in §1
    // is 19 digits and matched, which would have made this guard cry wolf on a
    // correct file. Require at least one a-f, which every real sha has and a
    // decimal id never does.
    const shas = [...HANDOFF.matchAll(/`([0-9a-f]{7,40})`/g)]
      .map((m) => m[1])
      .filter((h) => /[a-f]/.test(h));
    expect(shas, [
      'HANDOFF.md names a commit sha. The deployed sha has ONE home:',
      'the ✅ DEPLOYED line in STATE.md, which `npm run deploy:owed` reads.',
      'If you need to point at a commit, name the tag or say "see STATE.md".',
    ].join('\n')).toEqual([]);
  });

  it('names no file that is not there', () => {
    const missing = namedPaths(HANDOFF)
      .filter((p) => !(p in ABSENT_ON_PURPOSE))
      .filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, 'HANDOFF.md points at files that do not exist.').toEqual([]);
  });
});
