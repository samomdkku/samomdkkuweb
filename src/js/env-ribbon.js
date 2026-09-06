// ==============================================
// ENV RIBBON — say, on the page, when this is NOT production.
//
// docs/TEAM-WORKFLOW.md §1 asks for one global marker on every non-production
// build.
//
// ⚠️ WHAT THIS IS **NOT** FOR, corrected 2026-08-27 after the owner pushed back
// with "people would have to login to see student data isn't it" — they were
// right. A preview is NOT an extra data-exposure surface. It runs against
// samo-dev, whose RLS is identical to production's, so an anonymous visitor
// gets exactly what they get on the live site: 401 on `students` and `people`,
// 200 on the two things that are public there anyway. `npm run dev:check`
// proves that in both directions and is the reason D2's no-door-gate design is
// sound. **Do not justify this ribbon as protecting data. It does not.**
//
// What it IS for is CONFUSION, which is a real and cheap failure: someone
// filing a bug about "production" from a branch build, or making test edits
// believing they are on dev when they are on the live site. Both waste a
// session and one of them writes to the real database.
//
// TWO INDEPENDENT SIGNALS, because either alone has a bad failure mode:
//
//   1. VITE_ENV_NAME, when set to anything other than 'production'.
//   2. the host being *.pages.dev — every preview lives there, and unlike an
//      env var it cannot be forgotten when a box is rebuilt.
//
// ⚠️ THE POLARITY IS DELIBERATE AND IS NOT WHAT §1 DESCRIBES. §1 says the var
// is 'production' only on the VM and everything else paints a ribbon. That
// makes a MISSING var paint "PREVIEW" across the live site — a visible incident
// for every student, caused by forgetting an env var on a VM rebuild. Here an
// absent var paints nothing, and signal 2 still catches every real preview. The
// failure mode is a missing ribbon on a preview, seen only by developers.
//
// 📌 A LOCAL `npm run dev` DOES paint one, since 2026-09-06 — not because this
// file changed (it did not; `ribbonLabel(undefined, 'localhost')` is still
// null), but because `tools/dev-env.mjs` now SETS `VITE_ENV_NAME=development`
// when it points the dev server at samo-dev. Reading this file alone would
// suggest localhost shows nothing, which is why the cross-file behaviour is
// named here and asserted in `dev-env.test.js`.
// ==============================================

/**
 * Does this environment get a ribbon, and saying what? Exported for the test.
 *
 * ORDER MATTERS, and it was decided rather than left to fall out:
 * an EXPLICIT `production` wins over the host check. "Explicit configuration
 * beats inference" is the less surprising rule, and it leaves an escape hatch
 * if the live site ever moves onto a pages.dev host.
 *
 * That does not weaken the host signal for the case it was added for. The
 * failure being defended against is a FORGOTTEN variable on a rebuilt box —
 * and an absent variable is not `production`, so the host check still fires.
 * Only somebody deliberately writing `production` onto a preview can silence
 * it, and that is their statement to make.
 */
/**
 * WHAT A PREVIEW ACTUALLY PROMISES — one sentence, one home.
 *
 * It promises that WRITES do not reach production. It does NOT promise the data
 * is fake: `samo-dev` is an UNMASKED copy of production (D1,
 * docs/TEAM-WORKFLOW.md — "no masking, dev holds production data as it is"), so
 * every name, email and รหัสนักศึกษา visible on a preview belongs to a real
 * person.
 *
 * ⚠️ auth.js used to say "ข้อมูลที่นี่ไม่ใช่ของจริง" — *the data here is not
 * real* — while this file said the true thing two lines from the same idea. One
 * claim, two homes, only one correct: the shape this repo pays for most
 * (`.claude/rules/mistakes.md` class 6). It was also false in the DANGEROUS
 * direction: told the data is fake, a reasonable person screenshots it, pastes
 * it, or forwards it. Both messages now read from here.
 */
export const PREVIEW_SCOPE_NOTE = 'ข้อมูลที่แก้ที่นี่ไม่มีผลกับของจริง';

export function ribbonLabel(envName, hostname) {
  if (envName === 'production') return null;
  if (envName) return envName.toUpperCase();
  if (/\.pages\.dev$/i.test(String(hostname || ''))) return 'PREVIEW';
  return null;
}

export function mountEnvRibbon() {
  const label = ribbonLabel(import.meta.env.VITE_ENV_NAME, location.hostname);
  if (!label) return;
  if (document.querySelector('.samo-env-ribbon')) return;
  const el = document.createElement('div');
  el.className = 'samo-env-ribbon';
  el.setAttribute('role', 'status');
  el.textContent = `${label} — ไม่ใช่เว็บจริง ${PREVIEW_SCOPE_NOTE}`;
  document.body.appendChild(el);
}
