// ============================================================
// tool-frame.test.js — the guards for Lane B. docs/DEPT-TOOLS.md §8.1–8.2.
//
// ⛔ THE ONE THAT MATTERS is "the sandbox has no allow-same-origin". Everything
// that makes this lane safe — a ฝ่าย shipping HTML nobody reviews line by line,
// approved by a peer rather than the owner — rests on that single missing word.
// Adding it would look like a fix ("the frame can't read its own storage") and
// would silently delete the entire model.
//
// It is asserted on the RENDERED markup, never on the EMBED_SANDBOX constant:
// a guard written from the same list as the code can only ever confirm the
// list (`.claude/rules/mistakes.md`, class 7). What a browser acts on is the
// attribute in the DOM, so that is the subject.
//
// FALSIFICATION, run before committing: add `allow-same-origin` to
// EMBED_SANDBOX → the sandbox test goes red; put `localStorage.x = 1` in
// public/embed/starter/index.html → the folder test goes red; delete the
// starter's README `Owner:` line → the owner test goes red. All three were
// watched failing on the assertion named, then restored.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderToolFrame, embedSrc, embedSlugFromPath,
  clampHeight, HEIGHT_MESSAGE, MIN_HEIGHT_PX, MAX_HEIGHT_PX,
} from './tool-frame.js';
import { checkEmbedFolder, filesOutsideToolLane } from './embed-checks.js';
import { readEmbedFolder } from '../../tools/embed-fs.mjs';
import { embedTools, toolPath } from '../data/tools.js';
import { renderToolCard } from './tool-card.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f) => readFileSync(`${ROOT}${f}`, 'utf8');
const main = read('src/js/main.js');

describe('the frame is isolated — the whole security model', () => {
  it('the RENDERED frame carries a sandbox without allow-same-origin', () => {
    const html = renderToolFrame({ slug: 'starter', name: 'x' });
    const attr = /sandbox="([^"]*)"/.exec(html);
    expect(attr, 'the frame renders no sandbox attribute AT ALL').toBeTruthy();
    expect(attr[1], [
      'The frame declares allow-same-origin, which puts it back on the site\'s',
      'own origin: it can then read the Supabase session, the parent DOM and',
      'cookies. That single word is the entire isolation for a lane where a',
      'ฝ่าย ships HTML that a PEER approves, not the owner.',
    ].join('\n')).not.toContain('allow-same-origin');
    // The capabilities the lane does grant, so a silent narrowing is visible.
    for (const t of ['allow-scripts', 'allow-forms', 'allow-popups']) {
      expect(attr[1], `${t} was dropped — tools that used it now fail silently`).toContain(t);
    }
  });

  it('every embed is served from its own folder under /embed/', () => {
    expect(embedSrc('golden-period')).toBe('/embed/golden-period/');
  });

  it('the height channel is identified by SOURCE, not origin', () => {
    // An opaque frame's origin is the string "null" — which every OTHER opaque
    // frame on the page also has, so an origin check would accept any of them.
    const src = read('src/js/tool-frame.js');
    expect(src).toContain('e.source !== frame.contentWindow');
    expect(src, 'origin cannot be the check for an opaque frame')
      .not.toMatch(/e\.origin\s*===/);
  });

  it('a reported height is clamped, and nonsense is ignored', () => {
    expect(clampHeight(800)).toBe(800);
    expect(clampHeight(1)).toBe(MIN_HEIGHT_PX);
    expect(clampHeight(9e9)).toBe(MAX_HEIGHT_PX);
    for (const junk of [undefined, null, 'tall', NaN, {}]) expect(clampHeight(junk)).toBeNull();
  });

  it('there is no fallback TIMER — the floor is CSS, so it cannot misfire', () => {
    // A timer-driven fallback fires on the slow-but-working case and this repo
    // has paid for exactly that (the boot watchdog, frontend-ui.md). The floor
    // is min-height in CSS and is released only when a real height arrives.
    const css = read('src/css/tool-frame.css');
    expect(css).toMatch(/\.tool-frame\s*\{[^}]*min-height:\s*70vh/);
    expect(read('src/js/tool-frame.js')).not.toMatch(/setTimeout\s*\(/);
  });

  it('one message listener for the life of the page, not one per mount', () => {
    const src = read('src/js/tool-frame.js');
    expect((src.match(/addEventListener\('message'/g) || []).length).toBe(1);
    expect(src, 'the listener must be guarded so remounting cannot stack them')
      .toContain('if (listening) return;');
  });
});

describe('an embed route reaches the frame', () => {
  it('the slug is parsed from the path, with or without a trailing slash', () => {
    expect(embedSlugFromPath('/tools/golden-period')).toBe('golden-period');
    expect(embedSlugFromPath('/tools/golden-period/')).toBe('golden-period');
    expect(embedSlugFromPath('/tools')).toBeNull();
    expect(embedSlugFromPath('/tools/a/b')).toBeNull();
    // Not a route: it must never be able to climb out of public/embed/.
    expect(embedSlugFromPath('/tools/../../etc/passwd')).toBeNull();
  });

  it('the router resolves an embed path to the shared pane', () => {
    expect(main, 'pathToTab must fall through to the embed pattern')
      .toContain("if (embedToolFor(p)) return 'pills-tool-embed-tab';");
    // Sliced by STRUCTURE, never by distance-in-characters: the same rule
    // route-normalise.test.js uses, and the reason it uses it is that a
    // comment mentioning the function name sits 400 lines from the function.
    const body = /function applyPathRoute\(\)\s*\{[\s\S]*?\n\}/.exec(main)?.[0];
    expect(body, 'applyPathRoute not found — did it move or get renamed?').toBeTruthy();
    expect(body, [
      'The frame must be mounted from applyPathRoute, not from shown.bs.tab:',
      'two embed routes share one pane, so moving between them re-shows a tab',
      'that is already active and Bootstrap fires no shown event — the reader',
      'would see tool A under tool B\'s URL.',
    ].join('\n')).toContain('mountToolFrame(embed)');
  });

  it('the pane and its off-tablist button both exist', () => {
    expect(read('index.html')).toContain('tab-tool-embed.html');
    expect(read('src/html/navbar.html')).toContain('id="pills-tool-embed-tab"');
    const pane = read('src/html/tab-tool-embed.html');
    expect(pane).toContain('id="pills-tool-embed"');
    expect(pane).toContain('id="toolFrameHost"');
    // The iframe is written by the renderer, never by hand: a second home for
    // the sandbox attribute is a second place to get it wrong.
    expect(pane, 'the pane hand-writes an iframe — the sandbox must have ONE home')
      .not.toContain('<iframe');
  });

  it('an embed renders the same in-app card as any other route', () => {
    const t = embedTools()[0];
    const card = renderToolCard({ ...t, launcher: true });
    expect(card).toContain(`data-dept-tool-path="/tools/${t.slug}"`);
    expect(card).toContain(`href="/tools/${t.slug}"`);
  });

  it('no embed slug is shadowed by an exact PATH_ROUTES entry', () => {
    // pathToTab matches PATH_ROUTES FIRST, so an embed whose slug collides with
    // a hand-written route silently never renders — the OLD page keeps winning
    // and nothing reports it. The live case: /tools/golden-period is a native
    // pane today, and the ฝ่าย's real version is expected to arrive as an embed
    // under that exact slug. Delete the pane and its route in the SAME commit.
    const routes = [...main.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1]);
    const shadowed = embedTools()
      .filter((t) => routes.includes(`/tools/${t.slug}`))
      .map((t) => `/tools/${t.slug}`);
    expect(shadowed, [
      'An embed slug collides with an exact route in PATH_ROUTES. The exact',
      'match wins, so the embed is unreachable and the old page renders in its',
      'place — with no error anywhere. Remove the PATH_ROUTES entry and its',
      'pane, or give the embed a different slug.',
    ].join('\n')).toEqual([]);
  });

  it('an embed stores no path — the slug IS the route', () => {
    for (const t of embedTools()) {
      expect(t.path, `${t.slug} carries a path as well as a slug`).toBeUndefined();
      expect(toolPath(t)).toBe(`/tools/${t.slug}`);
    }
  });
});

describe('every embed folder obeys the rules', () => {
  // Imported, not re-implemented: two readers of one folder is the drift the
  // registry itself was built to delete, and the CI test reading LESS than the
  // CLI is the direction that fails green.
  const readFolder = readEmbedFolder;

  it('the registry and the folders agree in BOTH directions', () => {
    // → a routed tool with no folder 404s; ← a folder with no entry is dead
    // code nobody can reach, and dead code in a contributor lane is a trap.
    const routed = embedTools().map((t) => t.slug).sort();
    expect(routed.length, 'no embed tools at all — this guard would be vacuous')
      .toBeGreaterThan(0);
    const dir = `${ROOT}public/embed`;
    const onDisk = existsSync(dir)
      ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort()
      : [];
    expect(onDisk).toEqual(routed);
  });

  it('each folder passes check:embeds', () => {
    const problems = [];
    for (const t of embedTools()) {
      problems.push(...checkEmbedFolder({
        slug: t.slug,
        files: readFolder(`${ROOT}public/embed/${t.slug}`),
      }));
    }
    expect(problems, 'run `npm run check:embeds` for the same list').toEqual([]);
  });

  it('the starter still carries the height reporter it teaches', () => {
    // The six lines every tool copies. If the starter loses them, every tool
    // copied from it afterwards is silently missing its height channel.
    const html = read('public/embed/starter/index.html');
    expect(html).toContain(HEIGHT_MESSAGE);
    expect(html).toContain('parent.postMessage(');
    expect(html).toContain('ResizeObserver');
  });
});

describe('a tool/* branch can only reach the tool lane', () => {
  // §8.3. What makes a PEER approval safe is not the review — it is that the
  // diff CANNOT contain auth.js. Falsified against the CLI on a real tool/*
  // branch too: legal → pass, one edited auth.js → fail naming it, an
  // unreadable base ref → exit 1, because UNKNOWN must never read as PASS.
  it('allows a tool folder at any depth, plus the one registry file', () => {
    expect(filesOutsideToolLane([
      'public/embed/golden-period/index.html',
      'public/embed/golden-period/data.js',
      'public/embed/golden-period/img/logo.png',
      'src/data/tools.js',
    ])).toEqual([]);
  });

  it('refuses everything else, including the near misses', () => {
    expect(filesOutsideToolLane([
      'src/js/auth.js',
      'package.json',
      'supabase/migrations/0177_x.sql',
      'server/deploy.sh',
      '.github/workflows/build.yml',
      'src/data/tools.test.js',       // near miss: not the registry
      'public/embed/index.html',      // near miss: not inside a tool folder
      'public/robots.txt',
    ]).length).toBe(8);
  });

  it('the boundary runs inside the REQUIRED build job, not its own workflow', () => {
    // A required check with nothing to report on non-tool branches blocks every
    // OTHER pull request — this repo held main red for a day exactly that way.
    const ci = read('.github/workflows/build.yml');
    expect(ci).toContain('npm run check:tool-boundary');
    expect(ci).toContain('npm run check:embeds');
    expect(readdirSync(`${ROOT}.github/workflows`),
      'a separate tool-boundary workflow would not block, and would report nothing on every other PR')
      .not.toContain('tool-boundary.yml');
  });
});

describe('the rules can actually fail — falsified, not assumed', () => {
  // Reintroduce each hazard against the checker and watch it name it. Written
  // because a rule nobody has seen go red is a rule nobody knows works.
  const base = { 'index.html': '<p>ok</p>', 'README.md': 'Owner: someone\n' };
  const run = (files) => checkEmbedFolder({ slug: 'x', files: { ...base, ...files } });

  it('passes a clean folder', () => expect(run({})).toEqual([]));

  it('catches a missing index.html', () => {
    expect(checkEmbedFolder({ slug: 'x', files: { 'README.md': 'Owner: a\n' } })
      .join(' ')).toContain('no index.html');
  });

  it('catches a README with no owner', () => {
    expect(run({ 'README.md': 'a tool\n' }).join(' ')).toContain('Owner:');
  });

  it('catches localStorage, which throws on an opaque origin', () => {
    expect(run({ 'index.html': '<script>localStorage.x=1</script>' })
      .join(' ')).toContain('localStorage');
  });

  it('catches a reach for the parent, but NOT the height channel', () => {
    expect(run({ 'index.html': '<script>parent.document.title="x"</script>' })
      .join(' ')).toContain('parent/top');
    expect(run({ 'index.html': '<script>parent.postMessage({a:1},"*")</script>' })).toEqual([]);
  });

  it('catches an off-allowlist CDN, and allows an on-list one', () => {
    expect(run({ 'index.html': '<script src="https://evil.example/x.js"></script>' })
      .join(' ')).toContain('evil.example');
    expect(run({ 'index.html': '<script src="https://cdn.jsdelivr.net/x.js"></script>' })).toEqual([]);
  });

  it('is not fooled by the words appearing in a COMMENT', () => {
    // The mirror image of every check above: a guard that fires on prose makes
    // the starter's own explanation of the rules illegal.
    expect(run({ 'index.html': '<script>// never use localStorage here\n</script>' })).toEqual([]);
    expect(run({ 'index.html': '<script>/* parent.foo is forbidden */</script>' })).toEqual([]);
  });
});
