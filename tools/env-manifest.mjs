// ============================================================
// env-manifest.mjs — `.env.local.example` IS the contract. This reads it.
//
// ⛔ WHY THIS IS ITS OWN FILE AND NOT PART OF env-check.mjs. Vite BUNDLES
// `vite.config.js` and everything it imports into one module to load it, and a
// `#!/usr/bin/env node` shebang that is no longer on line 1 is a syntax error:
//
//     tools/env-check.mjs:1:396: ERROR: Syntax error "!"
//     ...tools/env-check.mjs";#!/usr/bin/env node
//
// The whole test suite fails to START, which is loud but says nothing about
// shebangs. So anything reachable from `vite.config.js` lives in a file with no
// shebang — asserted by src/js/dev-env.test.js so the next person meets a
// sentence instead of that error.
//
// ⛔ WHAT THIS REPLACED, and why. `REQUIRED` and `OPTIONAL` were two
// hand-written arrays sitting beside the file they described. The owner asked
// the question that killed them: *"incase in the future there's more key, or
// key is changed, it would be tiresome"*. A list beside the thing it describes
// is this repo's most-paid-for shape (`.claude/rules/mistakes.md` class 6) —
// and worse, nothing told a contributor their `.env.local` had fallen behind.
//
// Now the example is the single contract:
//   an ACTIVE   `NAME=`   line  → required to run the site
//   a COMMENTED `# NAME=` line  → optional, for database work
//
// Adding a variable is ONE edit to `.env.local.example`. `npm run env:check`
// starts asking for it, `npm run setup` starts accepting it, `npm run
// env:share` starts offering it, and every contributor is told about it on
// their next `npm run dev`.
// ============================================================

/** Split `.env.local.example` into what is required and what is optional. */
export function manifest(exampleText) {
  const required = [];
  const optional = [];
  for (const raw of String(exampleText).split(/\r?\n/)) {
    const active = /^([A-Z][A-Z0-9_]*)=/.exec(raw);
    if (active) { required.push(active[1]); continue; }
    const commented = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(raw);
    if (commented) optional.push(commented[1]);
  }
  return { required, optional };
}

/**
 * Is this value still the example's placeholder?
 *
 * Checked because pasting some-but-not-all of a block is the common slip, and a
 * leftover placeholder is INDISTINGUISHABLE from a real value to every other
 * check — it is present, it is non-empty, and it is wrong.
 */
export function isPlaceholder(name, value) {
  if (!value) return false;
  const v = String(value).trim();
  return /^paste-/.test(v)
    || /^sbp_paste-/.test(v)
    || v.includes('your-dev-project-ref')
    || v === 'postgresql://user:password@host:5432/postgres';
}
