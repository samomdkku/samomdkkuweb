// ==============================================
// `hidden` MUST WIN FROM OUR OWN STYLESHEET.
//
// The UA rule is `[hidden] { display: none }` with NO `!important`, so any
// author rule that sets `display` on the same element beats it and the
// attribute silently does nothing. The app does this in several places — the
// ปีการศึกษา picker, the ขยาย/ย่อทั้งหมด button and every ฝ่าย panel body on
// the public org chart all declare a `display` AND are toggled with
// `element.hidden = true`.
//
// It worked anyway, by ACCIDENT: Bootstrap's reboot ships
// `[hidden]{display:none!important}`, and index.html loads Bootstrap from
// cdn.jsdelivr.net. MEASURED in a headless browser with that one <link>
// blocked and nothing else changed:
//
//     Bootstrap CSS     .orgc-unit-body[hidden] computed    #orgBody height
//     ─────────────     ───────────────────────────────     ───────────────
//     loaded            display: none                          3,463 px
//     blocked           display: flex                         22,474 px   ← every ฝ่าย open
//     blocked, + fix    display: none                          3,318 px
//
// So the whole disclosure mechanism on that page hung on a third-party
// stylesheet arriving. A filtered campus network, a self-hosted Bootstrap at
// another version, or dropping the CDN would each turn it off — and the failure
// is CSS's usual silent one: nothing throws, the page just renders everything.
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: delete the `[hidden]` rule from
// base.css, or drop its `!important`, and watch the matching assertion fail.
// Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

// STRIPPED, and that is load-bearing rather than tidy: the rule's own comment
// block in base.css spells out `[hidden] { display: none }` while explaining the
// bug. A raw-text match would be satisfied by that PROSE and would still pass
// with the real declaration deleted — the exact failure `confirm-modal.test.js`
// shipped with once (`.claude/rules/mistakes.md`, class 7).
const base = stripComments(readFileSync(new URL('../css/base.css', import.meta.url), 'utf8'));
const meCss = readFileSync(new URL('../css/me.css', import.meta.url), 'utf8');
const meJs = stripComments(readFileSync(new URL('./me-page.js', import.meta.url), 'utf8'));
const homeHtml = readFileSync(new URL('../html/tab-home.html', import.meta.url), 'utf8');

describe('the [hidden] attribute is honoured by a rule this repo owns', () => {
  it('base.css declares it — not Bootstrap, not the UA sheet', () => {
    const rule = base.match(/\[hidden\]\s*\{([^}]*)\}/);
    expect(rule, 'base.css must carry a [hidden] rule; without it the attribute '
      + 'is beaten by any class that sets `display`').toBeTruthy();
    expect(rule[1].replace(/\s+/g, '')).toMatch(/display:none/);
  });

  it('and declares it !important, because specificity alone is a coin flip', () => {
    // `[hidden]` is (0,1,0). So is `.orgc-unit-body`. Equal specificity means
    // SOURCE ORDER decides, and base.css is imported FIRST by main.css — so
    // without `!important` the later file wins and the rule is decorative.
    const rule = base.match(/\[hidden\]\s*\{([^}]*)\}/);
    expect(rule[1]).toMatch(/!important/);
  });

  it('CONTROL: the hazard is live — a class that sets `display` IS toggled by `.hidden`', () => {
    // A guard whose control finds nothing cannot tell "protected" from "there
    // was never anything to protect". This asserts the dangerous shape still
    // EXISTS in the codebase: `.home-me-alert` declares a display, and
    // me-page.js flips its `hidden` property. (Re-derived 2026-10-31: the
    // previous subject, `.orgc-unit-body` + org-chart.js's toggleNode, went
    // with แผนผัง.)
    //
    // ⚠️ If this assertion ever fails, the subject has MOVED — do not delete it,
    // re-derive it. Grep `src/css` for a class that declares `display` and whose
    // element some module sets `.hidden` on, and name that one here instead.
    const decl = meCss.match(/\n\.home-me-alert\s*\{([^}]*)\}/);
    expect(decl, '.home-me-alert must still exist for this control to mean anything').toBeTruthy();
    expect(decl[1], '.home-me-alert no longer sets `display` — re-derive this control')
      .toMatch(/display:\s*[a-z-]+/);
    expect(decl[1]).not.toMatch(/display:\s*none/);

    // …and the JS really does toggle it as an attribute rather than a class.
    expect(homeHtml).toMatch(/id="homeMeAlert"[^>]*class="[^"]*home-me-alert|class="[^"]*home-me-alert[^"]*"[^>]*id="homeMeAlert"/);
    expect(meJs).toMatch(/alert\.hidden\s*=/);
  });
});
