// signed-file-integrity.test.js — the ratchet for the 0181 report.
//
// REPORTED: "some หนังสือโครงการ has been อนุมัติแล้ว but there isn't signature
// sign on the pdf" — three หนังสือ, approved 2026-09-03, no signed file. The
// PDFs were later found sitting in Google Drive, referenced by nothing.
//
// The database half is fixed by migration 0181 and guarded live by
// tools/proj0181-prof-upload.sql. This file guards the FOUR frontend
// properties that turned one refused write into a signature nobody missed for
// six days. Each `it` names the exact thing that shipped.
//
// These are source-shape assertions, not behaviour tests: the handlers they
// cover need a live Bootstrap modal, a Drive round-trip and a PostgREST
// session, none of which exist in jsdom. A source assertion earns its place
// only when it binds to something a wrong implementation CANNOT also satisfy,
// so each one below asserts an ORDER or a DATA DEPENDENCY, never the presence
// of a word. Comments are stripped first — `confirm-modal.test.js` once passed
// by matching prose in a comment, and every comment in this feature now
// discusses the very strings being searched for.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import { SIGN_STATUS_META } from './data.js';
import { CONFIRM_VARIANTS } from './ui-prompt.js';

const inbox = stripComments(
  readFileSync(new URL('./inbox.js', import.meta.url), 'utf8'));
const api = stripComments(
  readFileSync(new URL('./api.js', import.meta.url), 'utf8'));

/** Body of a top-level `async function <name>(…) { … }`, brace-matched.
 *  Slicing by line number is how a CSS block once got lifted out mid-comment
 *  and silently swallowed three rules (mistakes class 6) — so match structure. */
function fnBody(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found — did it get renamed?`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name} never closed`);
}

describe('a refused row must not leave a file behind in Drive', () => {
  // Drive is written BEFORE the row, always. When the row was refused the PDF
  // stayed in Drive, shared ANYONE_WITH_LINK, invisible to every screen here.
  it('createFileOrUndo deletes the Drive file when the row is refused', () => {
    const body = fnBody(inbox, 'createFileOrUndo');
    const del = body.indexOf('deleteProjectFile');
    const rethrow = body.indexOf('throw err');
    expect(del).toBeGreaterThan(-1);
    // The undo has to happen on the FAILURE path and before the error escapes,
    // or the caller's own catch shows an alert while the orphan survives.
    expect(body.indexOf('catch')).toBeLessThan(del);
    expect(del).toBeLessThan(rethrow);
  });

  it('every Drive upload in this module records through it', () => {
    // A second upload path that calls createFile() directly would reintroduce
    // the orphan for its own case only — the shape this repo calls "a fix on
    // one path is not a fix". createFileOrUndo's own body is the sole caller.
    const direct = inbox.split('\n')
      .filter((l) => /\bcreateFile\(/.test(l) && !/createFileOrUndo/.test(l));
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatch(/return await createFile\(row\)/);
  });
});

describe('re-signing must not destroy the signature it is replacing', () => {
  // Both handlers used to retire the existing signed file — the row AND its
  // Drive object — BEFORE uploading the replacement, so a refused upload left
  // the หนังสือ with no signature at all.
  for (const fn of ['onSignEsignClick', 'onSignReupload']) {
    it(`${fn} uploads before it retires the old signature`, () => {
      const body = fnBody(inbox, fn);
      const upload = body.indexOf('uploadSignedFile(');
      const retire = body.indexOf('removeExistingSignedFor(');
      expect(upload).toBeGreaterThan(-1);
      expect(retire).toBeGreaterThan(-1);
      expect(upload).toBeLessThan(retire);
    });

    it(`${fn} excludes the row it just created from the retirement`, () => {
      // The new row carries the SAME signs_file_id as the one being replaced,
      // so without exceptId the cleanup deletes the replacement it was called
      // to make room for — a worse bug than the one being fixed.
      expect(fnBody(inbox, fn)).toMatch(/removeExistingSignedFor\([^)]*exceptId/s);
    });
  }
});

describe('the UI may not claim a signature that does not exist', () => {
  it('the request-level status label does not say ลงนามแล้ว', () => {
    // "accepted" is an APPROVAL; attaching a file is optional. Labelling it
    // ลงนามแล้ว asserted a signature for every case it covered, and was wrong
    // for the one that mattered.
    expect(SIGN_STATUS_META.accepted.label).not.toContain('ลงนาม');
    expect(SIGN_STATUS_META.accepted.label).toBe('อนุมัติแล้ว');
  });

  it('the accepted-with-no-file chip is a warning, not a green tick', () => {
    // The chip for `request.status === 'accepted'` when the file has no signed
    // version. It used to carry .is-signed and bi-patch-check.
    const chip = inbox.match(/request\.status === 'accepted'\)\s*chip = `([^`]*)`/);
    expect(chip, 'the accepted chip moved — re-point this assertion').toBeTruthy();
    expect(chip[1]).not.toContain('is-signed');
    expect(chip[1]).toContain('ยังไม่มีไฟล์ลงนาม');
  });

  it('the decision notification headline is derived from hasSigned', () => {
    // `head` is the email SUBJECT and the VP-Admin title — what staff read
    // before closing the หนังสือ. It used to come from `accepted` while the
    // BODY came from `hasSigned`: one function, two disagreeing claims.
    const body = inbox.slice(inbox.indexOf('function notifySignDecision'));
    const head = body.slice(body.indexOf('const head'), body.indexOf('notifyUniStaff'));
    expect(head).toMatch(/hasSigned/);
    expect(inbox).toMatch(/notifySignDecision\(\{[^}]*hasSigned/s);
  });
});

describe('the unusual case is confirmed, not passed in silence', () => {
  it('อนุมัติ with no signed file asks first', () => {
    const body = fnBody(inbox, 'onSignAcceptClick');
    expect(body).toMatch(/openProjectConfirm/);
    // …and only when we actually KNOW there is none. A failed lookup must not
    // accuse the professor of skipping a step he may have completed.
    expect(body).toMatch(/couldCheck && !hasSigned/);
  });

  it('เสร็จสิ้น warns when an approved request never got a file', () => {
    const body = fnBody(inbox, 'onDocStatusClick');
    const guard = body.slice(body.indexOf("next === 'completed'"));
    expect(guard).toMatch(/openProjectConfirm/);
    expect(guard).toMatch(/is_signed/);
  });
});

describe('a refused save says what happened, in Thai', () => {
  it('createFile does not put the raw PostgREST sentence in front of a person', () => {
    // 0181 showed an อาจารย์ `new row violates row-level security policy for
    // table "project_files"` in an alert(). rest-error.js exists to stop
    // exactly that; createFile threw error.message straight through.
    const body = fnBody(api, 'createFile');
    // Only the REFUSAL path is in scope. The first line of createFile throws on
    // a malformed argument — that is a programming error the caller never
    // surfaces, and holding it to the same bar would just teach the next person
    // to loosen this assertion.
    const refusal = body.slice(body.indexOf('const { data, error }'));
    const thrown = [...refusal.matchAll(/throw new Error\(([\s\S]*?)\n\s*\);/g)].map((m) => m[1]);
    expect(thrown.length, 'no refusal throw found in createFile').toBeGreaterThan(0);
    for (const t of thrown) {
      // It must LEAD with Thai the reader can act on. The machine's own words
      // may follow, bracketed, for whoever is reading a screenshot.
      expect(t).toMatch(/บันทึกไฟล์ไม่สำเร็จ/);
      expect(t).not.toMatch(/^\s*error\??\.message/);
    }
  });
});

describe('a signed PDF must actually show the signature', () => {
  // Reachable ONLY since the nginx .mjs fix: e-sign had never run in
  // production, so this was latent. It produces the SAME symptom as the report
  // that started all this — a หนังสือ marked ลงนามแล้ว whose PDF shows nothing.
  const esign = stripComments(
    readFileSync(new URL('./esign.js', import.meta.url), 'utf8'));

  it('the placement aspect comes from the bitmap, not from layout', () => {
    // useSignature() captures a placement in the same tick it assigns
    // overlay.src, so clientHeight is still 0 — and "ทุกหน้า" copies whatever
    // placement it finds, stamping a ZERO-HEIGHT image on every page.
    const ratios = esign.slice(esign.indexOf('function currentRatios'));
    const block = ratios.slice(0, ratios.indexOf('}\n'));
    expect(block).toMatch(/aspect:\s*sigAspect/);
    expect(block, 'aspect must not be measured through the DOM')
      .not.toMatch(/aspect:.*client(Height|Width)/);
  });

  it('sigAspect is set where the bitmap is cropped', () => {
    const trim = esign.slice(esign.indexOf('function trimmedSignature'));
    expect(trim.slice(0, trim.indexOf('\n}'))).toMatch(/sigAspect\s*=\s*h\s*\/\s*w/);
  });

  it('the embed refuses to draw a zero-height signature', () => {
    // Belt and braces: no path may reach drawImage with a non-positive height,
    // because the result looks signed to every downstream check and to nobody's
    // eyes. pdf-lib knows the PNG's real proportions.
    const confirm = esign.slice(esign.indexOf('async function onConfirm'));
    expect(confirm).toMatch(/Number\.isFinite\(p\.aspect\)\s*&&\s*p\.aspect\s*>\s*0/);
    expect(confirm).toMatch(/png\.height\s*\/\s*png\.width/);
  });
});

describe('the confirm modal is a singleton — its variant must not leak', () => {
  // The OK button is ONE element reused by every caller. The reset list was
  // hand-written beside the add, so a new variant stayed on the button and the
  // next confirm wore two colour classes at once.
  it('the reset is derived from CONFIRM_VARIANTS, not hand-written', () => {
    const prompt = stripComments(
      readFileSync(new URL('./ui-prompt.js', import.meta.url), 'utf8'));
    expect(prompt).toMatch(/classList\.remove\(\.\.\.CONFIRM_VARIANTS\.map/);
    expect(prompt, 'a literal remove() list is how the leak happened')
      .not.toMatch(/classList\.remove\('btn-/);
  });

  it('every okVariant passed anywhere is one the reset knows about', () => {
    // The list and its users, checked against each other — a variant nobody
    // resets is exactly the bug.
    const used = [...inbox.matchAll(/okVariant:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(used.length, 'no okVariant found — has the option been renamed?')
      .toBeGreaterThan(0);
    for (const v of used) expect(CONFIRM_VARIANTS).toContain(v);
  });
});
