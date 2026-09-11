// ============================================================
// VitePress config — the docs site. Phase 5 of docs/TEAM-WORKFLOW.md §8.
//
// ⛔ THE SIDEBAR IS GENERATED, NOT WRITTEN. Every `.md` under `docs/` is found
// on disk and titled from its own first `# ` heading. There is deliberately no
// hand-maintained page list, because this repo has paid for that shape more
// than once: a list beside the thing it describes drifts, and the drift is
// invisible — a doc simply never appears in the sidebar and nobody notices it
// is missing (.claude/rules/mistakes.md, class 6). `src/js/docs-site.test.js`
// asserts the generator still reaches every file.
//
// WHAT IS PUBLISHED. All of `docs/`, deliberately — the owner chose the whole
// tree over a contributor-facing subset on 2026-08-30. The repository is
// already public, so nothing here is newly exposed; what changes is that it
// becomes browsable and indexable. **That is the reason nothing secret may go
// into `docs/`** — no key, no live URL that is meant to stay unlisted (the
// `samo-dev` project URL in particular), no student's name, รหัสนักศึกษา or
// photo. That was already the rule for a public repo; the site raises the
// price of breaking it.
// ============================================================
import { defineConfig } from 'vitepress';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// The owner/repo has ONE home — package.json's `repository.url`. This file
// hardcoded it four times on the day the site was built, which is exactly the
// drift the move to an organisation account will expose.
import { GITHUB_URL, PAGES_BASE } from '../../tools/repo-identity.mjs';

const DOCS = new URL('..', import.meta.url).pathname;

/** Directories under docs/ that are not pages. */
const SKIP_DIRS = new Set(['.vitepress', 'templates', 'node_modules', 'package', 'demos']);
// `demos/` is NOT documentation. `docs/demos/about-3d/README.md` is a decision
// still waiting on the owner, and it links a PRIVATE Claude artifact URL —
// publishing that link on a browsable site is the wrong shape regardless of
// whether the artifact itself is reachable. The files stay in the repository,
// where the person making the decision reads them.
// ⚠️ `docs/demos/about-3d/package/` is a VENDORED third-party npm tree — 1,195
// files and 37 MB checked in under docs/. It is not documentation, and building
// its stray READMEs into the site would publish someone else's package as if it
// were ours. Excluded by the `package` entry above; `srcExclude` below repeats
// it so VitePress does not glob them either.

/** Every markdown file under docs/, as paths relative to docs/. */
export function collect(dir = DOCS, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith('.md')) out.push(relative(DOCS, full));
  }
  return out;
}

/**
 * A page's title, taken from its own first `# ` heading.
 *
 * Falling back to the filename rather than throwing is deliberate: a file with
 * no heading is a real thing (a stub, a generated fragment) and should still be
 * reachable. An unreachable page is the failure this generator exists to avoid.
 */
export function titleOf(rel) {
  const text = readFileSync(join(DOCS, rel), 'utf8');
  const h1 = text.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].replace(/`/g, '');
  return rel.split(sep).pop().replace(/\.md$/, '');
}

/**
 * THE SIDEBAR, IN READING ORDER.
 *
 * Ordered by WHAT SOMEONE WANTS TO DO, not by what a document is. The first
 * version grouped by document type — "Plans, proposals and history", "Archive
 * — why it was done that way" — and the result was a site whose first click
 * was the invariants file and where 37 of 70 pages were session notes and
 * archived handoffs. The owner's verdict on 2026-08-31: "it's full of technical
 * jargon that is the memory of Claude ... start here should show how to run the
 * project".
 *
 * So the top of this list is a path: what you need → how to run it → how to
 * send a change. Everything an agent or a maintainer reads is real and stays
 * published, but it sits BELOW that path and is collapsed, because a
 * contributor is not looking for it.
 *
 * Two forms, and a group may use either:
 *   { text, files: [...] }  explicit top-level files, in the order given
 *   { text, dir: 'x' }      every doc under docs/x/, found on disk
 *
 * A file is never LOST by omission — anything unclaimed lands in an "Unsorted"
 * group and `src/js/docs-site.test.js` goes red naming it. That guard is the
 * reason this hand-written order is safe to keep (.claude/rules/mistakes.md
 * class 6: a hand-maintained list beside the thing it describes drifts, and the
 * drift is invisible).
 */
export const SIDEBAR = [
  {
    text: 'Getting started',
    dir: 'start',
    // A TUTORIAL HAS AN ORDER AND THE DISK DOES NOT. Left to `collect()` these
    // sort alphabetically — dependent-work, first-change, install,
    // prerequisites, troubleshooting — which hands a newcomer the hardest page
    // first and the setup page fourth. Anything under start/ that is missing
    // here still appears, at the end, so a new page is never lost.
    order: ['prerequisites.md', 'vault.md', 'install.md', 'where-it-runs.md', 'first-change.md', 'dependent-work.md', 'troubleshooting.md', 'sharing-credentials.md'],
  },
  {
    text: 'Contributing',
    files: ['contributing.md', 'DEPT-TOOLS.md'],
  },
  {
    text: 'How the system works',
    files: [
      'CONTEXT.md', 'INVARIANTS.md', 'PERSON-REGISTRY.md', 'EMAIL.md',
      'HOUSE-SYSTEM.md', 'house-data-spec-th.md', 'TEAM-ROLES-AND-PHOTOS.md',
    ],
  },
  {
    text: 'Reference',
    files: ['VERSIONING.md', 'MERGE-CHECKLIST.md', 'SELF-HOST.md', 'SUCCESSION.md'],
  },
  {
    text: 'Maintainer & agent notes',
    collapsed: true,
    files: [
      'TEAM-WORKFLOW.md', 'NEXT.md', 'PROJECT-ARCHITECTURE.md',
      'DISCORD-ROLE-SYNC.md',
      'KKU-SSO.md', 'KKU-SSO-MANUAL.md', 'AUTH-MODEL.md',
      // The two passport documents sit together on purpose: MERGE is the
      // finished DATABASE cutover, MONOREPO is the planned REPOSITORY merge.
      // Anyone who finds one is one click from learning the other exists,
      // which is the only thing that stops them being confused for each other.
      'SUPABASE-MIGRATION.md', 'PASSPORT-MERGE.md', 'PASSPORT-MONOREPO.md',
    ],
  },
  { text: 'Bug write-ups', dir: 'mistakes', collapsed: true },
  { text: 'Session notes', dir: 'state', collapsed: true },
  { text: 'Archive — why it was done that way', dir: 'state-archive', collapsed: true },
  { text: 'Design references', dir: 'design-refs', collapsed: true },
];

/** Kept for the guard's sake: every top-level file this sidebar claims. */
export const TOP_GROUPS = SIDEBAR.filter((g) => g.files);

const linkOf = (rel) => '/' + rel.replace(/\.md$/, '').split(sep).join('/');
const dirOf = (rel) => (rel.includes(sep) ? rel.split(sep)[0] : '');

/**
 * @returns {{ text: string, collapsed?: boolean, items: {text:string,link:string}[] }[]}
 */
export function buildSidebar(files = collect()) {
  const top = files.filter((f) => dirOf(f) === '' && f !== 'index.md');
  const claimed = new Set(SIDEBAR.flatMap((g) => g.files ?? []));
  const usedDirs = new Set(SIDEBAR.map((g) => g.dir).filter(Boolean));
  const groups = [];

  for (const g of SIDEBAR) {
    let items;
    if (g.dir) {
      items = files.filter((f) => dirOf(f) === g.dir);
      // Dated filenames — newest first, which is the order anyone wants them in.
      if (g.dir === 'state-archive') items = items.slice().reverse();
      if (g.order) {
        const rank = (f) => {
          const i = g.order.indexOf(f.split(sep).slice(1).join(sep));
          return i === -1 ? g.order.length : i;   // unlisted sinks to the end
        };
        items = items.slice().sort((a, b) => rank(a) - rank(b));
      }
    } else {
      items = g.files.filter((f) => top.includes(f));
    }
    if (!items.length) continue;
    groups.push({
      text: g.text,
      collapsed: g.collapsed ?? false,
      items: items.map((f) => ({ text: titleOf(f), link: linkOf(f) })),
    });
  }

  // Anything nobody classified — a top-level file, or a whole new subdirectory.
  // Empty in a healthy repo; the test says so. Its presence is the failure, not
  // the remedy: a page must never vanish from the sidebar quietly, because
  // nobody misses a page they do not know exists.
  const unsorted = [
    ...top.filter((f) => !claimed.has(f)),
    ...files.filter((f) => dirOf(f) !== '' && !usedDirs.has(dirOf(f))),
  ];
  if (unsorted.length) {
    groups.push({
      text: 'Unsorted — add these to SIDEBAR',
      collapsed: false,
      items: unsorted.map((f) => ({ text: titleOf(f), link: linkOf(f) })),
    });
  }
  return groups;
}

export default defineConfig({
  title: 'SAMO MDKKU — docs',
  description: 'Working documentation for the MDKKU SAMO student portal.',
  lang: 'th',
  // WHERE THIS BUILD WILL BE SERVED FROM — two answers, on purpose.
  //
  // The docs are built TWICE from this one config, exactly the way the passport
  // app already is (`PASSPORT_BASE=/passport/` in server/deploy.sh):
  //
  //   GitHub Actions   (no DOCS_BASE)      → /samomdkkuweb/  → Pages, the backup
  //   the KKU VM       DOCS_BASE=/docs/    → /docs/          → samo.md.kku.ac.th/docs
  //
  // WHY BOTH. `samo.md.kku.ac.th/docs` is the address people can be told and
  // will remember, and serving the real pages there (rather than bouncing to a
  // personal github.io URL) is what nextjs.org, tailwindcss.com, supabase.com
  // and kubernetes.io all do — measured 2026-08-31, all four answer 200 at the
  // path. KKU will not issue `docs.samo.md.kku.ac.th`, so the path is the only
  // official-looking address available.
  //
  // Pages is kept because a single build would make the VM a single point of
  // failure for the documentation — and documentation is what you go and read
  // when the thing it documents is broken. Keeping the default base means the
  // Pages copy needs no special handling: it is just what a build with no env
  // var produces.
  base: process.env.DOCS_BASE || PAGES_BASE,

  // ⛔ NOT INDEXED, deliberately. The repository has always been public, so
  // nothing here is newly exposed — but a rendered, crawlable site is a
  // different thing from a file in a repo, and this content is engineering
  // notes: infrastructure detail, a colleague's work email where it is
  // load-bearing evidence, the reasoning behind access rules. The audience is
  // the team and the ฝ่าย, who arrive from a link somebody gave them, not from
  // a search engine. `robots.txt` in `docs/public/` says the same thing to
  // crawlers that ignore the meta tag.
  head: [['meta', { name: 'robots', content: 'noindex, nofollow' }]],
  srcExclude: ['**/node_modules/**', 'templates/**', '**/package/**', 'demos/**'],
  cleanUrls: true,
  lastUpdated: true,

  // These docs reference source files, tools and skills by path constantly —
  // `server/deploy.sh`, `tools/db-query.mjs`, `skills/deploy-vm.md`. Those are
  // real paths in the repository and NOT pages on this site, so VitePress is
  // right that they do not resolve and wrong that it is a defect.
  //
  // ⛔ THERE USED TO BE A `/^\/(?!samomdkkuweb)/` ENTRY HERE. REMOVED
  // 2026-08-31 — it was the single most damaging line in this file. In markdown
  // you write a site link WITHOUT the base (`/contributing`, `/start/install`)
  // and VitePress prepends it at build time, so that pattern matched EVERY
  // internal link on the site and ignored it. Dead-link checking was therefore
  // off entirely, and the whole restructure could have shipped with broken
  // navigation and a green build. It was presumably written believing links
  // carry the base; they do not. Verified after removing it: the build still
  // passes, and a deliberately broken `/no-such-page-xyz` is now caught.
  ignoreDeadLinks: [
    /^\.\.\/(?!.*\.md$)/,
    /^(src|tools|skills|server|supabase|appscript|public|scripts)\//,
    /^\.\.\/\.\.\//, /\.(sh|mjs|js|sql|gs|json|html|css|py)$/,
  ],

  themeConfig: {
    outline: { level: [2, 3], label: 'ในหน้านี้ · On this page' },
    nav: [
      { text: 'Getting started', link: '/start/prerequisites' },
      { text: 'Contributing', link: '/contributing' },
      { text: 'How the system works', link: '/CONTEXT' },
      {
        text: 'Repo',
        items: [
          { text: 'GitHub', link: GITHUB_URL },
          { text: 'STATE.md — what is true right now', link: `${GITHUB_URL}/blob/main/STATE.md` },
          { text: 'CONTRIBUTING.md', link: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
          { text: 'The live portal', link: 'https://samo.md.kku.ac.th' },
        ],
      },
    ],
    sidebar: buildSidebar(),
    // Local search — no Algolia account, no third party, works offline.
    // ⚠️ Thai has no word boundaries, so a Thai term is findable only where the
    // prose already surrounds it with spaces (which is how these docs are
    // written: `ฝ่าย`, `หนังสือโครงการ`). Do not promise Thai substring search.
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'ค้นหา · Search', buttonAriaLabel: 'ค้นหา' },
          modal: {
            noResultsText: 'ไม่พบผลลัพธ์',
            footer: { selectText: 'เลือก', navigateText: 'เลื่อน', closeText: 'ปิด' },
          },
        },
      },
    },
    docFooter: { prev: 'ก่อนหน้า', next: 'ถัดไป' },
    darkModeSwitchLabel: 'ธีม',
    returnToTopLabel: 'กลับขึ้นบน',
    sidebarMenuLabel: 'เมนู',
    editLink: {
      pattern: `${GITHUB_URL}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Working docs. <strong>STATE.md is the status file and lives at the repo root, not here.</strong>',
      copyright: 'สโมสรนักศึกษา คณะแพทยศาสตร์ มหาวิทยาลัยขอนแก่น',
    },
  },
});
