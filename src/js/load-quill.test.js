// load-quill.test.js — source-text guard (this repo has no jsdom; `document`
// doesn't exist under plain Node, so these are structural checks, same
// pattern as chunk-names.test.js / qr-order.test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('load-quill.js', () => {
  const src = readFileSync(new URL('./load-quill.js', import.meta.url), 'utf8');

  it('does not call loadQuill() at module scope — only defines it', () => {
    // Every non-comment, non-definition line mentioning loadQuill must be
    // the export statement itself, never a bare call.
    const callSites = src
      .split('\n')
      .filter((l) => /loadQuill\(/.test(l) && !/function loadQuill/.test(l));
    expect(callSites).toEqual([]);
  });

  it('short-circuits when window.Quill already exists, before touching the DOM', () => {
    expect(src).toMatch(/if \(window\.Quill\)/);
  });

  it('caches the in-flight promise so a second caller gets the same one', () => {
    expect(src).toMatch(/let quillPromise = null/);
    expect(src).toMatch(/if \(quillPromise\) return quillPromise/);
  });

  it('resets the cache on failure so a later call can retry', () => {
    expect(src).toMatch(/quillPromise = null/);
    // appears at least twice: the initial declaration and the reset-on-catch
    expect(src.match(/quillPromise = null/g).length).toBeGreaterThanOrEqual(2);
  });

  it('injects a stylesheet link and a script tag, not an ES import (Quill is CDN-only, not an npm dep)', () => {
    expect(src).toMatch(/rel = 'stylesheet'/);
    expect(src).toMatch(/document\.createElement\('script'\)/);
    expect(src).not.toMatch(/^import .* from 'quill'/m);
  });
});

describe('main.js loads Quill lazily, not at module scope', () => {
  const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

  it('has no top-level `new Quill(` / `Quill.import(` / `Quill.register(` — only inside setupVsQuill', () => {
    const offenders = src
      .split('\n')
      .filter((line) => /\bnew Quill\(|Quill\.import\(|Quill\.register\(/.test(line))
      // Indented lines are inside setupVsQuill's .then() callback; a bare
      // column-0 statement would mean it runs at module evaluation again.
      .filter((line) => !/^\s/.test(line));
    expect(offenders).toEqual([]);
  });

  it('wires setupVsQuill to the VitalSound tab\'s shown.bs.tab event, not to module load', () => {
    expect(src).toMatch(/pills-vitalsound-tab['"]\)\?\.addEventListener\('shown\.bs\.tab',\s*setupVsQuill\)/);
  });

  it('imports loadQuill from load-quill.js', () => {
    expect(src).toMatch(/import \{ loadQuill \} from '\.\/load-quill\.js';/);
  });

  it('no longer calls initVsForm at module scope — setupVsQuill calls it once Quill resolves', () => {
    const topLevelInitVsForm = src
      .split('\n')
      .filter((line) => /^initVsForm\(/.test(line));
    expect(topLevelInitVsForm).toEqual([]);
    expect(src).toMatch(/initVsForm\(vsQuill\);/); // still called, just inside the .then()
  });

  it('guards vitalSoundForm submit against the window before Quill has loaded', () => {
    // vitalSoundForm has no `action` — before this file made Quill lazy,
    // initVsForm() ran at module load (before a user could see the form),
    // so a submit always had a listener calling preventDefault(). Now
    // there is a real gap (tab shown → Quill script fetched) where the
    // button is visible but initVsForm hasn't run yet; without a guard a
    // submit in that window falls through to the browser's default GET,
    // reloading the page and discarding whatever the user typed.
    const guard = src.match(/getElementById\('vitalSoundForm'\)\?\.addEventListener\('submit',[\s\S]*?\}, true\)/);
    expect(guard, 'capture-phase submit guard').not.toBeNull();
    expect(guard[0]).toMatch(/if \(vsQuillRef\) return;\s*e\.preventDefault\(\);/);
    // A swallowed submit must SAY so and retry the load (review 2026-10-31).
    expect(guard[0]).toMatch(/vsEditorNote\('/);
    expect(guard[0]).toMatch(/setupVsQuill\(\)/);
  });
});

describe('index.html no longer blocks on Quill in <head>', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('ships no quilljs <script> tag', () => {
    expect(html).not.toMatch(/<script[^>]*quilljs/);
  });

  it('ships no quilljs stylesheet <link> — load-quill.js injects it on demand', () => {
    expect(html).not.toMatch(/<link[^>]*quilljs/);
  });
});
