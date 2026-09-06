// ==============================================
// THE LIST OF REQUIRED ENV NAMES HAS ONE HOME, AND IT IS CHECKED IN.
//
// Before this, `docs/start/install.md` retyped the four SUPABASE_DEV_* names in
// a code block, and the guide hedged — "cp .env.local.example .env.local # if
// that example file exists" — because the file did not exist. A setup guide
// that is unsure whether its own first command works is a guide nobody has run.
//
// The names now live in `.env.local.example`, which git tracks. This asserts the
// two agree, in the direction that matters: a name the DOCS tell someone to set
// must exist in the example they were told to copy. The reverse is allowed —
// the example carries commented-out optional blocks the getting-started page
// deliberately does not mention.
//
// Class 6: two implementations of one rule drift, and a doc has no compiler.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED, OPTIONAL } from '../../tools/env-check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const EXAMPLE = readFileSync(join(ROOT, '.env.local.example'), 'utf8');
const INSTALL = readFileSync(join(ROOT, 'docs', 'start', 'install.md'), 'utf8');
const PREREQ = readFileSync(join(ROOT, 'docs', 'start', 'prerequisites.md'), 'utf8');
const GITIGNORE = readFileSync(join(ROOT, '.gitignore'), 'utf8');

/** Every `NAME=` the example actually sets, ignoring commented-out lines. */
const declared = new Set(
  [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

describe('.env.local.example', () => {
  it('declares the run-the-site names as fill-in lines (control)', () => {
    // ⚠️ THIS ASSERTED ALL FOUR UNTIL 2026-09-06, which is how every volunteer
    // came to be handed SUPABASE_DEV_DB_URL — a connection that ignores every
    // permission rule over an unmasked copy of real student records. The split
    // now comes from env-check's own REQUIRED/OPTIONAL rather than a list
    // retyped here, so the two cannot drift; src/js/dev-env.test.js asserts the
    // powerful pair stays commented out.
    expect([...declared].sort()).toEqual([...REQUIRED].sort());
  });

  it('carries no real value — it is checked in, and .env.local is not', () => {
    // A key committed once is in the history for ever, and this repo is public.
    expect(EXAMPLE, 'a Supabase management token (sbp_) with a real body')
      .not.toMatch(/sbp_[A-Za-z0-9]{20,}/);
    expect(EXAMPLE, 'a JWT — anon keys start eyJ and are long')
      .not.toMatch(/eyJ[A-Za-z0-9_-]{30,}/);
    expect(EXAMPLE, 'a real postgres password')
      .not.toMatch(/postgresql:\/\/[^\s:]+:(?!password@)[^\s@]{8,}@/);
    // The project ref is 20 lowercase letters. The placeholder must not be one.
    expect(EXAMPLE).not.toMatch(/https:\/\/[a-z]{20}\.supabase\.co/);
  });

  it('is TRACKED while .env.local is ignored — the whole point of the pair', () => {
    expect(GITIGNORE).toMatch(/^\.env\.local$/m);
    // `npm run setup` writes this before changing an existing file, and on a
    // maintainer's machine it is a copy of every production credential they
    // hold. It must be ignored by NAME — a `.env.local.*` wildcard would work
    // and would also untrack the example, which is asserted below.
    expect(GITIGNORE, 'npm run setup writes .env.local.backup and git can see it')
      .toMatch(/^\.env\.local\.backup$/m);
    expect(GITIGNORE, '.env.local.example must not be swept up by a wildcard')
      .not.toMatch(/^\.env\.local\.\*$/m);
    expect(GITIGNORE).not.toMatch(/^\.env\.local\.example$/m);
  });

  it('names no production credential as something to SET', () => {
    // These reach the live database and the live VM. They are mentioned in a
    // trailing comment so a file holding them is recognisable — never as a
    // `NAME=` a contributor would fill in.
    for (const secret of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'SAMO_VM_SUDO_PASSWORD']) {
      expect(declared, `${secret} is presented as a value to fill in`).not.toContain(secret);
    }
  });
});

describe('the getting-started pages and the example agree', () => {
  it('every env name the pages name is one the example knows about', () => {
    // The example MENTIONS all four; only the required pair is an active line.
    // So the pages are checked against both lists, and dev-env.test.js is what
    // keeps the optional pair commented out.
    const known = [...REQUIRED, ...OPTIONAL];
    const named = new Set(
      [...`${INSTALL}\n${PREREQ}`.matchAll(/\bSUPABASE_DEV_[A-Z_]+/g)].map((m) => m[0]),
    );
    expect(named.size, 'the pages stopped naming any variable at all').toBeGreaterThan(0);
    for (const n of named) {
      expect(known, `install.md/prerequisites.md tell a contributor to set ${n}, `
        + 'which env-check does not know about — one of the two is stale').toContain(n);
    }
  });

  it('the pages tell a contributor the required pair, and do not demand the rest', () => {
    // The consequence being guarded: a page that lists all four as "what you
    // need" undoes the split in the file, because people follow the page.
    for (const n of REQUIRED) {
      expect(`${INSTALL}\n${PREREQ}`, `the pages never name ${n}, which is `
        + 'needed to run the site').toContain(n);
    }
  });

  it('install.md points at the example instead of hedging about it', () => {
    expect(INSTALL).toContain('cp .env.local.example .env.local');
    expect(INSTALL, 'the guide still hedges about whether its own file exists')
      .not.toMatch(/if that example file exists/);
  });
});

// ==============================================
// THE FIRST COMMAND A CONTRIBUTOR IS TOLD TO RUN MUST WORK FOR A CONTRIBUTOR.
//
// docs/start/install.md told a new contributor to verify their setup with
// `npm run dev:check`. That command compares samo-dev against PRODUCTION
// (tools/dev-check.mjs reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), which
// a contributor does not have and must never be sent — so it would exit 1 with
// "✗ PRODUCTION: URL or anon key missing from .env.local" having proved nothing
// about the four keys they actually pasted.
//
// A verification step that fails on a CORRECT setup is worse than none: it
// blames the reader for the guide's mistake, at the exact moment they have no
// way to tell which of the two is wrong.
// ==============================================
describe('the contributor-facing setup check', () => {
  const ENVCHECK = readFileSync(join(ROOT, 'tools', 'env-check.mjs'), 'utf8');
  const DEVCHECK = readFileSync(join(ROOT, 'tools', 'dev-check.mjs'), 'utf8');
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  it('is wired up as npm run env:check', () => {
    expect(PKG.scripts['env:check']).toBe('node tools/env-check.mjs');
  });

  it('reads NO production credential — that is the whole point', () => {
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_ACCESS_TOKEN']) {
      expect(ENVCHECK, `env-check reads ${name}, which a contributor does not have`)
        .not.toMatch(new RegExp(`env\\.${name}\\b`));
    }
  });

  it('checks every name the example declares (control: the two lists agree)', () => {
    // Written from the EXAMPLE, not from a list retyped here — a guard built
    // from the same list as the code cannot see a name missing from both.
    const checked = [...ENVCHECK.matchAll(/'(SUPABASE_DEV_[A-Z_]+)'/g)].map((m) => m[1]);
    for (const name of declared) {
      expect(checked, `env-check never looks at ${name}`).toContain(name);
    }
  });

  it('dev:check STILL requires production — do not "simplify" the two into one', () => {
    // dev:check is a parity guard and its value is that it needs both sides.
    // Teaching it to skip the production half when credentials are absent would
    // make it pass in the one case it exists to catch.
    expect(DEVCHECK).toMatch(/env\.VITE_SUPABASE_URL/);
    expect(DEVCHECK).toMatch(/env\.VITE_SUPABASE_ANON_KEY/);
  });

  it('install.md sends contributors to env:check, and warns off the other one', () => {
    expect(INSTALL).toMatch(/npm run env:check/);
    expect(INSTALL, 'install.md still tells a contributor to run dev:check as their check')
      .not.toMatch(/^```bash\nnpm run dev:check\n```/m);
    expect(INSTALL, 'the warning that dev:check is not theirs has gone')
      .toMatch(/Not `npm run dev:check`/);
  });
});

// ==============================================
// THE STABLE ADDRESS FOR `main` MUST BE NAMED WHEREVER SOMEONE LOOKS FOR IT.
//
// `preview.samomdkkuweb.pages.dev` was built on 2026-08-31 to answer exactly one
// question — *"what's the stable one i can view"* — after every obvious
// Cloudflare link turned out to render the moved splash. A workflow mirrors
// `main` onto a branch named `preview`, which Cloudflare then serves there
// permanently.
//
// Two days later the getting-started docs were written and said `main` has no
// preview, and `preview-url.mjs` — the tool a person runs to FIND an address —
// printed "main is PRODUCTION, and it does not get a preview" with no mention of
// it. The capability existed, was deployed, and was invisible from every place a
// person would look. That is worse than not having built it: the owner had to
// ask for it a second time.
//
// So the address is pinned in the three places that answer the question, and the
// workflow that produces it is pinned too — if the mirror is ever deleted, these
// go red rather than the docs quietly pointing at a dead host.
// ==============================================
describe('the stable address for main', () => {
  const WHERE = readFileSync(join(ROOT, 'docs', 'start', 'where-it-runs.md'), 'utf8');
  const PREVURL = readFileSync(join(ROOT, 'tools', 'preview-url.mjs'), 'utf8');
  const MIRROR = readFileSync(join(ROOT, '.github', 'workflows', 'preview-mirror.yml'), 'utf8');

  it('is produced by a workflow that mirrors main onto the `preview` branch', () => {
    // The address is an alias Cloudflare derives from a BRANCH NAME. If this
    // workflow stops pushing that branch, the host stops existing and every
    // reference below becomes a link to nothing.
    expect(MIRROR).toMatch(/preview/);
    expect(MIRROR, 'the mirror no longer triggers on main').toMatch(/branches:\s*\[?\s*main/);
  });

  it('is named by the tool people run to find an address', () => {
    expect(PREVURL, 'preview-url.mjs tells someone on main there is no preview, '
      + 'which is the question the mirror was built to answer')
      .toMatch(/preview\.\$\{PROJECT\}\.pages\.dev/);
  });

  it('is named on the page about where the site runs', () => {
    expect(WHERE).toMatch(/preview\.samomdkkuweb\.pages\.dev/);
  });

  it('says it is a MIRROR, not a branch to work on', () => {
    // Someone who reads "a branch named preview" and treats it as staging will
    // have their commits force-pushed away without warning.
    expect(WHERE.toLowerCase()).toMatch(/mirror/);
    expect(PREVURL.toLowerCase()).toMatch(/mirror/);
  });

  it('warns that the BARE host is the retired one', () => {
    // The trap that caused all of this: samomdkkuweb.pages.dev bounces to the
    // moved splash, and it is the link Cloudflare's own dashboard offers.
    // index.html's guard is anchored, so only the bare host redirects.
    const INDEX = readFileSync(join(ROOT, 'index.html'), 'utf8');
    // ⚠️ Assert the ANCHORING, not the host list. This used to match the exact
    // alternation `^(samomdkkuweb|refactorsamomdkkuweb)`, which went red on
    // 2026-09-04 when a third retired host was legitimately added — the
    // property (only a BARE retired host redirects, never a subdomain) was
    // never in danger. A guard pinned to today's list fails on correct changes
    // and teaches people to edit the guard, which is how it stops meaning
    // anything. host-guard.test.js owns the full behaviour, across all six
    // entries and both directions; this only pins that the anchor is present.
    expect(INDEX, 'the host guard is no longer anchored, so a subdomain preview '
      + 'would bounce to the splash too').toMatch(/\/\^\([a-z|]*samomdkkuweb[a-z|]*\)\\\.pages\\\.dev\$\/i/);
    expect(PREVURL).toMatch(/retired|moved splash/i);
  });
});
