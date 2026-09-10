// A listing call must not change Drive.
//
// HANDOFF §13a named this trap before the code existed: "It must NOT create the
// folder if missing: a listing call with a side effect is a trap, and
// `walkProjectsPathByCode_` creates by default." That helper get-or-CREATEs at
// every segment, and also RENAMES a folder it matches by code and MOVES a
// top-level folder it finds in the wrong place. A reader built on it would
// quietly restructure the Drive tree of anyone who ran the sweep.
//
// So `prform.gs` grew a read-only twin. These assertions are what keep it one:
// a future edit that "reuses" the writer, or adds a create to the reader, goes
// red here rather than in somebody's Drive.
//
// ⚠️ THE INSTRUMENT IS THE FUNCTION BODY, SLICED BY STRUCTURE. An earlier bug in
// this repo lifted a CSS block out by LINE NUMBER and swallowed three rules with
// an unclosed comment (.claude/rules/mistakes.md class 6). These slice from the
// `function name(` that opens the body to the line that closes it at column 0,
// and every test asserts the slice is non-empty first — a regex that matched
// nothing would otherwise satisfy every "does not contain" assertion below.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const GS = readFileSync(new URL('../../../appscript/prform.gs', import.meta.url), 'utf8');

/** The body of a top-level `function name(...) { ... }`, by structure. */
function body(name) {
  const start = GS.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const end = GS.indexOf('\n}', start);
  return end === -1 ? '' : GS.slice(start, end + 2);
}

// Everything Drive offers that CHANGES something. `createResponse` is a JSON
// helper and is not one of them, so the pattern requires a Drive-ish receiver.
const MUTATORS = [
  'createFolder', 'createFile', 'setName', 'moveTo', 'setTrashed',
  'setSharing', 'removeFile', 'addFile', 'setOwner', 'setDescription',
];

const READERS = [
  'findProjectsPathByCode_',
  'findTopFolder_',
  'findProjectSubfolderByCode_',
  'getAppRootReadOnly_',
  'handleListProjectFolderFiles',
  'handleStatProjectFiles',
];

describe('the read-only Drive helpers really are read-only', () => {
  for (const fn of READERS) {
    it(`${fn} exists and its body was actually sliced`, () => {
      // The control for every assertion below: an empty slice cannot contain a
      // mutator either, so a missing function would look perfectly safe.
      expect(body(fn).length, `${fn} not found in prform.gs`).toBeGreaterThan(40);
    });

    it(`${fn} calls nothing that changes Drive`, () => {
      const src = body(fn);
      const found = MUTATORS.filter((m) => src.includes(`.${m}(`));
      expect(found, `${fn} mutates Drive via ${found.join(', ')}`).toEqual([]);
    });

    it(`${fn} does not delegate to a get-or-create helper`, () => {
      const src = body(fn);
      // The specific regression this guards: reaching for the writer because it
      // already walks the path correctly.
      expect(src).not.toContain('walkProjectsPathByCode_');
      expect(src).not.toContain('getOrCreateTopFolder_');
      expect(src).not.toContain('getOrCreateProjectSubfolderByCode_');
      expect(src).not.toContain('getAppRoot_(');
    });
  }

  it('the WRITER still creates — so the two are genuinely different', () => {
    // Without this, the tests above would also pass if somebody made
    // walkProjectsPathByCode_ read-only, breaking every upload in the app.
    // A pair of assertions is what tells "the reader is safe" apart from
    // "both are now the same function".
    const w = body('getOrCreateProjectSubfolderByCode_');
    expect(w.length).toBeGreaterThan(40);
    expect(w).toContain('.createFolder(');
  });
});

describe('the folder listing cannot be used to enumerate Drive', () => {
  // This /exec URL is public, unauthenticated and shipped in the browser
  // bundle, and this repo is public. A bare listing would turn a guessed
  // Projects/<PRJ-…>/<DOC-…> path into every file id inside it, and
  // getProjectFileData turns an id into the BYTES of a signed หนังสือ.
  const h = body('handleListProjectFolderFiles');

  it('requires knownFileId, and refuses without one', () => {
    expect(h).toContain('knownFileId');
    expect(h).toMatch(/if\s*\(!known\)/);
  });

  it('verifies the named file is in THAT folder, not merely somewhere', () => {
    // Checked against the folder's own children. A membership test that asked
    // "is this file under Projects/" would let any one id unlock every folder.
    expect(h).toMatch(/getId\(\)\s*===\s*known/);
    expect(h).toMatch(/if\s*\(!isKnownHere\)/);
  });

  it('answers folderFound:false rather than creating a missing folder', () => {
    // "the folder is empty" and "the folder is not there" must not look alike:
    // that is the sweep's own control against reporting a broken walk as clean.
    expect(h).toContain('folderFound: false');
  });

  it('is allow-listed to Projects/ like every other project handler', () => {
    expect(h).toContain("canonTopFolder_(firstSegment_(path)) !== 'Projects'");
    expect(h).toContain("path.indexOf('..')");
  });
});

describe('statProjectFiles discloses less than the handler that already exists', () => {
  const h = body('handleStatProjectFiles');

  it('returns metadata, never bytes', () => {
    // getProjectFileData already returns base64 bytes for any Projects/ id, so
    // metadata-only is strictly narrower and needs no new gate. If this ever
    // returns bytes, that argument stops holding.
    expect(h).not.toContain('base64');
    expect(h).not.toContain('getBlob');
  });

  it('reports trashed, which a folder listing cannot', () => {
    // A trashed Drive file still serves publicly (docs/mistakes/integrations.md)
    // and getFiles() omits it, so this is the only place the sweep can learn it.
    expect(h).toContain('file.isTrashed()');
  });

  it('is allow-listed to Projects/ and bounded in size', () => {
    expect(h).toContain('fileLivesUnderProjects_(file)');
    expect(h).toMatch(/ids\.length > \d+/);
  });
});
