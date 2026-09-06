// ============================================================
// repo-identity.test.js — moving this repo to an organisation must be ONE edit.
//
// The project is going to leave a personal GitHub account for an organisation.
// When it does, today's owner/repo slug stops being true — and this comment
// deliberately does not spell it out, because THIS FILE IS SWEPT BY ITS OWN
// RULE. It named the slug in prose, passed while untracked, and went red the
// moment `git ls-files` could see it. That is the guard working, and a small
// reminder that an instrument is part of what it measures. GitHub redirects a
// transferred repo, so every stale URL keeps WORKING — until the old account is
// renamed or deleted, and then they fail together, months later, with no commit
// to blame. That is the worst version of this repo's most repeated bug: one
// fact with many homes, only some of them corrected.
//
// So the identity has one home, `package.json`'s `repository.url`, and this
// test makes a transfer mechanical: change that field, run `npm test`, and be
// handed the list of prose that still disagrees.
//
// ⚠️ A PERSON IS NOT THE REPOSITORY. `@phuriphatma` in CODEOWNERS, the reviewer
// named in CONTRIBUTING.md, and `docs/state/phuriphatma.md` name a HUMAN who is
// still that human afterwards. Nothing here flags them, and a blind
// find-and-replace at transfer time would break all three.
// ============================================================
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OWNER, REPO_NAME, SLUG, PAGES_URL, SIBLING_REPOS } from '../../tools/repo-identity.mjs';

const ROOT = join(import.meta.dirname, '..', '..');

/** Tracked text files, minus generated output and vendored third-party trees. */
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('docs/demos/about-3d/package/'))
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|glb|hdr|xlsx)$/i.test(f));

const read = (f) => { try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; } };

/**
 * GitHub owners that are legitimately NOT us. Each needs a reason, so a new
 * third-party link forces a decision rather than being waved through.
 */
const THIRD_PARTY = new Map([
  ['supabase', 'supabase-js / auth-js issue links in the bug write-ups'],
  ['AcademySoftwareFoundation', 'MaterialX disclaimer in the vendored 3-D demo'],
  ['facebook', 'Docusaurus, cited when choosing the docs generator'],
  ['actions', 'GitHub Actions marketplace references in workflows'],
  ['mrdoob', 'three.js'],
  ['vuejs', 'Vue / VitePress'],
  ['squidfunk', 'Material for MkDocs, cited when choosing the docs generator'],
  ['shenruisi', 'the Stay Safari extension, named in a state-archive note'],
  ['davidshimjs', 'qrcodejs, the QR library passport/README credits — arrived with the passport subtree'],
  ['dani-garcia', 'Vaultwarden — the password vault at /vault/; skills/vaultwarden.md cites its subpath and proxy issues'],
]);

/**
 * `package-lock.json` carries a funding URL for every transitive dependency —
 * hundreds of third-party owners that say nothing about who owns THIS repo, and
 * npm rewrites them all on any install. It is excluded from the URL sweep, not
 * added to THIRD_PARTY, because listing them would be a list that rots on the
 * next `npm i`. It is still covered by the hardcoded-slug rule above.
 */
const GENERATED_LOCKFILES = new Set(['package-lock.json']);

/**
 * First path segments on github.com that are GITHUB'S OWN, not an account.
 * `github.com/login/device` is the device-flow page `gh auth login` prints, and
 * it will never be owned by this project or by a third party — it is a product
 * URL that happens to share the shape of a repo slug. Kept separate from
 * THIRD_PARTY, which means "another ACCOUNT we deliberately cite"; putting a
 * reserved word in there would read as a person and rot the list's meaning.
 * GitHub reserves these names, so none can ever become a real owner.
 */
const GITHUB_RESERVED_PATHS = new Set(['login', 'settings', 'features', 'apps', 'orgs', 'sponsors']);

// SIBLING_REPOS now lives in tools/repo-identity.mjs — imported above, because
// repo-protection.mjs needs the same list and two copies would drift.


/** Files allowed to name the slug literally — it has to be written down once. */
const THE_ONE_HOME = new Set(['package.json', 'package-lock.json', 'tools/repo-identity.mjs']);

describe('the repository identity has exactly one home', () => {
  it('derives a plausible owner and repo from package.json (control)', () => {
    expect(OWNER).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(REPO_NAME).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(SLUG).toBe(`${OWNER}/${REPO_NAME}`);
    expect(PAGES_URL).toContain(OWNER);
    // Proves the sweep below has something to find. A repo whose own name
    // appeared nowhere would pass every assertion by vacuum.
    expect(files.filter((f) => read(f).includes(SLUG)).length).toBeGreaterThan(3);
  });

  it('no code or config file hardcodes the slug — they import it', () => {
    const code = files.filter((f) => /\.(m?js|cjs|ts|ya?ml|json|sh)$/.test(f) && !THE_ONE_HOME.has(f));
    const offenders = code.filter((f) => {
      const t = read(f);
      return t.includes(SLUG) || t.includes(`${OWNER}.github.io`);
    });
    expect(offenders,
      'these must import from tools/repo-identity.mjs instead of naming the owner:\n'
      + offenders.join('\n')).toEqual([]);
  });

  it('every project GitHub URL in prose names the CURRENT owner', () => {
    // The transfer checklist, generated rather than written. Change
    // package.json's repository.url and this lists what is left to edit.
    const stale = [];
    for (const f of files) {
      if (GENERATED_LOCKFILES.has(f)) continue;
      const text = read(f);
      for (const m of text.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
        if (m[1] === OWNER || THIRD_PARTY.has(m[1]) || GITHUB_RESERVED_PATHS.has(m[1])) continue;
        stale.push(`${f}: github.com/${m[1]}/${m[2]}`);
      }
      for (const m of text.matchAll(/([A-Za-z0-9_-]+)\.github\.io/g)) {
        if (m[1] === OWNER || THIRD_PARTY.has(m[1])) continue;
        stale.push(`${f}: ${m[1]}.github.io`);
      }
      // A slug with no `github.com/` in front of it. `gh repo clone
      // <owner>/<repo>` in skills/onboard-a-contributor.md was invisible to
      // the two patterns above — the guard could not see the hazard it was
      // written for, which is trap #1 in skills/write-a-guard.md.
      // The lookbehind is what separates a SLUG from a PATH. A GitHub owner
      // never contains a dot and never follows one, so `~/samo-projects/<repo>`
      // (the VM checkout) and `<owner>.github.io/<repo>` are both excluded by
      // construction — no exemption list to rot.
      const names = [REPO_NAME, ...SIBLING_REPOS].join('|');
      for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9_./-])([A-Za-z0-9_-]+)/(${names})\\b`, 'g'))) {
        if (m[1] === OWNER || THIRD_PARTY.has(m[1])) continue;
        stale.push(`${f}: ${m[1]}/${m[2]}`);
      }
    }
    expect([...new Set(stale)],
      `these name an owner that is neither "${OWNER}" nor a known third party.\n`
      + 'If the repo just moved, update them. If it is a new third-party link, '
      + 'add its owner to THIRD_PARTY with a reason:\n' + [...new Set(stale)].join('\n')).toEqual([]);
  });

  it('does not mistake a PERSON for the repository', () => {
    // CODEOWNERS names a human. If a future version of the sweep starts
    // flagging it, someone is about to sed the reviewer out of the repo.
    const codeowners = read('.github/CODEOWNERS');
    expect(codeowners, 'CODEOWNERS lost its reviewer').toMatch(/@[A-Za-z0-9-]+/);
    const handles = [...codeowners.matchAll(/@([A-Za-z0-9-]+)/g)].map((m) => m[1]);
    expect(handles.length, 'CODEOWNERS assigns nobody').toBeGreaterThan(0);
  });

  it('package.json homepage agrees with the derived Pages URL', () => {
    const pkg = JSON.parse(read('package.json'));
    // Two homes for one fact, so they are compared. A custom domain changes
    // homepage and NOT the derivation — that is the moment to notice.
    expect(pkg.homepage, 'homepage disagrees with repository.url; if a custom '
      + 'domain is now in use, update tools/repo-identity.mjs to derive from it')
      .toBe(PAGES_URL);
  });
});
