// ==============================================
// THE SIGN-IN MODAL: BOTH ROUTES VISIBLE, NEITHER ROUTE MISDESCRIBED.
//
// This screen has now been reported by the owner THREE times, and every report
// was about the same thing wearing different clothes: the markup or the wording
// quietly told a reader that a route was not for them.
//
// 1. THE PASSWORD FORM IS NOT HIDDEN. It used to live inside a `.collapse`
//    opened by a text link. That made a legitimate way in look like a footnote
//    — and it silently broke the account switcher: `pickAccount()` prefills
//    `#signinLoginUsername` and focuses `#signinLoginPassword`, and `.focus()`
//    on a display:none input is a no-op, so switching back to a password
//    account opened a modal that looked empty and did nothing.
//
// 2. THE COPY DESCRIBES AUDIENCES, NOT REQUIREMENTS. "นักศึกษาและบุคลากร MDKKU
//    ใช้บัญชี Google ของมหาวิทยาลัย" + "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com" read
//    as a RULE. Google sign-in accepts any Google account.
//
// 3. AND SO DOES EMPHASIS. The fix for (2) named บุคคลทั่วไป but set the two KKU
//    domains in bold brand green — the only emphasis on the line — and the
//    owner read the button as KKU-only again ("it also gmail.com email etc.").
//    Bold is a claim. The caption must NAME GMAIL, and must not make the KKU
//    domains the loudest thing on the line.
//
// 4. THE SIGNUP LINK NEVER SAID WHAT THE ACCOUNT WAS FOR. "ยังไม่มีบัญชีชื่อ
//    ผู้ใช้? สมัครสมาชิก" — the one fact about that route (it is the anonymous
//    one) was on the screen the reader was leaving, never on the one where they
//    made the choice. Both panels now sit under a heading that names the route.
//
// PLUS ONE DEFECT THAT WAS NOT A WORDING PROBLEM: the register form advertised
// `minlength="4"` and "อย่างน้อย 4 ตัวอักษร" while `registerWithPassword()`
// rejects anything under 6. The form invited a password the code then refused.
// That is pinned DIFFERENTIALLY below — the number is read out of auth.js, so
// changing one side without the other fails.
//
// STATIC, AND COMMENT-STRIPPED FIRST. What is at risk here is markup structure
// and wording, not runtime behaviour — and a guard that reads comments can be
// satisfied by writing about the fix instead of making it (confirm-modal.test.js
// learned that the expensive way). This file's own comments describe the bad
// copy verbatim, so an un-stripped scan would find every forbidden phrase in
// the guard that forbids it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments, stripHtmlComments } from './strip-comments.js';

// NOT a local regex. Every guard here used to carry its own, and every one was
// blind wherever a module contained `'image/*'` — the `/*` opened a "comment"
// that ran to the next `*​/` in the file and deleted 13,839 characters of
// main.js. That is how the duplicate-handler assertion below passed with a
// duplicate handler sitting in main.js. See strip-comments.js.
const stripHtml = stripHtmlComments;
const stripJs = (s) => stripComments(s);

const HTML = stripHtml(
  readFileSync(new URL('../html/modal-signin.html', import.meta.url), 'utf8'),
);
const SIGNIN_JS = stripJs(
  readFileSync(new URL('./signin-modal.js', import.meta.url), 'utf8'),
);
const AUTH_JS = stripJs(
  readFileSync(new URL('./auth.js', import.meta.url), 'utf8'),
);

// THE SLICE IS THE GUARD'S EYESIGHT, so it is checked before anything is
// asserted about it. If the markup is reordered so a slice comes back empty,
// every `not.toMatch` below passes for the worst possible reason.
const LOGIN = HTML.slice(HTML.indexOf('id="signinLoginScreen"'), HTML.indexOf('id="signinRegisterScreen"'));
const REGISTER = HTML.slice(HTML.indexOf('id="signinRegisterScreen"'));

describe('sign-in modal — the guard can see the markup', () => {
  it('found both screens and the Google button', () => {
    expect(LOGIN.length).toBeGreaterThan(500);
    expect(REGISTER.length).toBeGreaterThan(500);
    expect(HTML).toContain('samoGoogleSignIn');
  });
});

describe('sign-in modal — both routes are visible at once', () => {
  it('has no collapse anywhere in the modal', () => {
    expect(HTML).not.toMatch(/class="[^"]*\bcollapse\b/);
    expect(HTML).not.toMatch(/data-bs-toggle="collapse"/);
  });

  it('keeps the username and password inputs in the markup, not behind a link', () => {
    expect(LOGIN).toContain('id="signinLoginUsername"');
    expect(LOGIN).toContain('id="signinLoginPassword"');
  });

  it('never offers signup as the answer to "you have no account"', () => {
    // "ยังไม่มีบัญชี?" is true of every first-time visitor, including the ones
    // who should press Google — which creates their account implicitly, so they
    // never sign up at all. The generic phrasing reads as "sign up first".
    expect(LOGIN).not.toContain('ยังไม่มีบัญชี');
    expect(LOGIN).not.toMatch(/ยังไม่มีบัญชีชื่อผู้ใช้/);
  });

  it('names the anonymous route AT the link that opens it', () => {
    // The one fact about this route used to live only on the screen the reader
    // was leaving. It is in the switch line and in the register screen's lede.
    const switchLine = LOGIN.slice(LOGIN.indexOf('signin-switch'));
    expect(switchLine).toMatch(/ไม่ต้องการเปิดเผยตัวตน/);
    expect(switchLine).toMatch(/<a[^>]*samoShowSigninScreen\('register'\)/);
    // And again beside the fields it describes. NOT in the screen title: Google
    // sits above the divider on that screen too, so titling the whole screen
    // "anonymous" would contradict the button above it.
    expect(REGISTER).toMatch(/class="signin-lede"[^>]*>[^<]*ไม่เปิดเผยตัวตน/);
  });

  it('uses ONE verb for creating an account', () => {
    // The screen said both "สร้างบัญชี" (title, anonymous link) and "สมัครสมาชิก"
    // (register submit) for the same action. Two words for one thing is
    // something a first-time reader has to resolve before they can act, and it
    // is the kind of drift that creeps back one string at a time.
    const hasCreate = HTML.includes('สร้างบัญชี');
    const hasRegister = HTML.includes('สมัครสมาชิก');
    expect(hasCreate, 'the modal should name the action at all').toBe(true);
    expect(hasRegister,
      'pick one: this modal uses สร้างบัญชี, so สมัครสมาชิก must not appear too').toBe(false);
  });

  it('uses the Google-spec button, not a brand-coloured one', () => {
    // Google's branding guidelines permit white / dark / neutral fills only and
    // require the standard four-colour G at its own size. A brand-green button
    // with a monochrome glyph broke both — and read as "not a Google button",
    // which is most of why the screen felt unfamiliar.
    const btn = HTML.slice(HTML.indexOf('samoGoogleSignIn'), HTML.indexOf('signin-divider'));
    expect(btn).not.toMatch(/btn-custom/);
    for (const hex of ['#4285F4', '#34A853', '#FBBC05', '#EA4335']) {
      expect(btn, 'the four-colour G must be intact').toContain(hex);
    }
  });
});

describe('sign-in modal — the copy does not gate Google on a KKU address', () => {
  // FOUR reports, one cause. Each rewrite kept a parenthesised domain list
  // because KKU students were assumed to scan for it, and each time a glancer
  // read the list as the set of ACCEPTED addresses. The rule that survives:
  // no email domain appears in this modal at all.
  it('shows no email domain anywhere in the modal', () => {
    expect(HTML).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('never instructs the reader to pick a kku address', () => {
    expect(HTML).not.toContain('เลือกบัญชีที่ลงท้ายด้วย');
    expect(HTML).not.toContain('ใช้บัญชี Google ของมหาวิทยาลัย');
  });
});

describe('sign-in modal — the form asks for what the code accepts', () => {
  // A DIFFERENTIAL, because the alternative is two numbers that agree by
  // memory. The form said 4 for months while auth.js rejected 5.
  const minPassword = Number(
    AUTH_JS.match(/password\.length\s*<\s*(\d+)/)?.[1],
  );
  const minUsername = Number(
    AUTH_JS.match(/username\.length\s*<\s*(\d+)/)?.[1],
  );

  it('read both minimums out of auth.js (the control)', () => {
    expect(minPassword).toBeGreaterThan(0);
    expect(minUsername).toBeGreaterThan(0);
  });

  it('uses auth.js\'s password minimum in minlength AND in the help text', () => {
    expect(HTML).toContain(`id="signinRegisterPassword"`);
    const field = HTML.slice(
      HTML.indexOf('id="signinRegisterPassword"'),
      HTML.indexOf('id="signinRegisterConfirm"'),
    );
    expect(field).toContain(`minlength="${minPassword}"`);
    expect(field).toContain(`อย่างน้อย ${minPassword} ตัวอักษร`);
  });

  it('uses auth.js\'s username minimum in minlength AND in the help text', () => {
    const field = HTML.slice(
      HTML.indexOf('id="signinRegisterUsername"'),
      HTML.indexOf('id="signinRegisterPassword"'),
    );
    expect(field).toContain(`minlength="${minUsername}"`);
    expect(field).toContain(`อย่างน้อย ${minUsername} ตัวอักษร`);
  });

  it('keeps the rules in text that stays, not in a placeholder', () => {
    // A placeholder vanishes at the first keystroke — which is when the rule
    // starts to matter. Both hints are <p class="signin-help">.
    expect(REGISTER).not.toMatch(/placeholder="อย่างน้อย/);
    expect(REGISTER).toMatch(/class="signin-help"/);
  });
});

describe('sign-in modal — a failed Google sign-in never uses alert()', () => {
  // Found by task 17's phone friction sweep. Both the Google button's own
  // handler AND account-switch.js's saved-account picker called
  // `signInWithGoogle()` and showed any failure with a native alert() — which
  // goes SILENT for the rest of the page once a visitor has ticked Chrome's
  // "prevent this page from creating additional dialogs", reachable by
  // retrying a failed sign-in a couple of times. #signinGoogleAlert sits
  // outside both screens (the Google button is visible on either one), and
  // showGoogleSigninError() is the one place that writes to it.
  it('#signinGoogleAlert sits above the divider, outside both screens', () => {
    const el = HTML.slice(HTML.indexOf('id="signinGoogleAlert"') - 5, HTML.indexOf('id="signinGoogleAlert"') + 80);
    expect(HTML.indexOf('id="signinGoogleAlert"')).toBeGreaterThan(HTML.indexOf('samoGoogleSignIn'));
    expect(HTML.indexOf('id="signinGoogleAlert"')).toBeLessThan(HTML.indexOf('signin-divider'));
    expect(el).toContain('d-none');
  });

  it('signin-modal.js calls no native alert() at all', () => {
    expect(SIGNIN_JS).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });

  it('exports showGoogleSigninError and routes the Google handler through it', () => {
    expect(SIGNIN_JS).toMatch(/export function showGoogleSigninError/);
    const handler = SIGNIN_JS.slice(
      SIGNIN_JS.indexOf('window.samoGoogleSignIn'),
      SIGNIN_JS.indexOf('window.samoShowSigninScreen'),
    );
    expect(handler).toMatch(/showGoogleSigninError\(/);
  });

  it('showGoogleSigninError opens the modal if it is not already showing', () => {
    const fn = SIGNIN_JS.slice(SIGNIN_JS.indexOf('function showGoogleSigninError'));
    expect(fn).toMatch(/getOrCreateInstance/);
    expect(fn).toMatch(/\.show\(\)/);
  });

  it('showSigninScreen clears #signinGoogleAlert along with the other two', () => {
    const fn = SIGNIN_JS.slice(
      SIGNIN_JS.indexOf('export function showSigninScreen'),
      SIGNIN_JS.indexOf('function pickScreen'),
    );
    expect(fn).toMatch(/signinGoogleAlert[^;]*d-none/);
  });

  it('account-switch.js imports the shared helper instead of restating alert()', () => {
    const switchJs = stripJs(readFileSync(new URL('./account-switch.js', import.meta.url), 'utf8'));
    expect(switchJs).toMatch(/import\s*\{\s*showGoogleSigninError\s*\}\s*from\s*['"]\.\/signin-modal\.js['"]/);
    expect(switchJs).not.toMatch(/(^|[^.\w$])alert\s*\(/);
  });
});

describe('sign-in modal — one implementation, and it resets', () => {
  it('defines the handlers exactly once, in signin-modal.js', () => {
    // They were duplicated verbatim in main.js and admin-main.js.
    for (const entry of ['main.js', 'admin-main.js']) {
      const src = stripJs(readFileSync(new URL(`./${entry}`, import.meta.url), 'utf8'));
      expect(src, `${entry} must import the sign-in behaviour, not restate it`)
        .not.toMatch(/window\.samo(PasswordSignIn|PasswordRegister|ShowSigninScreen|GoogleSignIn)\s*=/);
      expect(src).toContain('mountSigninModal');
    }
    expect(SIGNIN_JS).toMatch(/window\.samoPasswordSignIn\s*=/);
    expect(SIGNIN_JS).toMatch(/window\.samoShowSigninScreen\s*=/);
  });

  it('reopens on the sign-in panel', () => {
    const reset = SIGNIN_JS.slice(SIGNIN_JS.indexOf("$('signinModal')"));
    expect(reset).toMatch(/'hidden\.bs\.modal'/);
    expect(reset).toMatch(/showSigninScreen\('login'\)/);
  });

  it('starts with the icon that matches the input — hidden means eye-slash', () => {
    // A DIFFERENTIAL between the markup's initial icon and the input's initial
    // type. They are set in two files: the <i> class here, and the toggle in
    // signin-modal.js. Change one without the other and the icon LIES about the
    // state of the field — silently, since nothing errors.
    const fields = HTML.match(/<input[^>]*type="password"[^>]*>[\s\S]*?<i class="bi ([a-z-]+)"/g) || [];
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const f of fields) {
      expect(f, 'a password field that starts hidden must show bi-eye-slash')
        .toMatch(/bi-eye-slash/);
    }
    // …and the reset path must restore that same icon.
    const reset = SIGNIN_JS.slice(SIGNIN_JS.indexOf("$('signinModal')"));
    expect(reset).toMatch(/classList\.add\('bi-eye-slash'\)/);
  });

  it('re-hides a revealed password when the modal closes', () => {
    const reset = SIGNIN_JS.slice(SIGNIN_JS.indexOf("$('signinModal')"));
    expect(reset).toMatch(/type = 'password'/);
  });

  it('keeps the dialog title in step with the screen it labels', () => {
    // One function sets both. A second one that moved only the panel is how a
    // screen ends up labelled as the other one.
    const fn = SIGNIN_JS.slice(
      SIGNIN_JS.indexOf('export function showSigninScreen'),
      SIGNIN_JS.indexOf('function pickScreen'),
    );
    expect(fn).toContain("classList.toggle('d-none'");
    expect(fn).toContain('signinTitleRegister');
  });
});
