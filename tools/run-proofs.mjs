#!/usr/bin/env node
// ============================================================
// run-proofs.mjs — run every live proof and print ONE verdict per proof.
//
// WHY THIS EXISTS. STATE.md tells each session to "run the proof covering what
// you touch", and the proofs are worth running — but they emit FOUR different
// shapes:
//
//   `verdict` column ......... authz-sweep-identity, pr0149
//   `result` column .......... house0144, shop0150
//   `status` column + a final `ALL PASS` SCORE row ... house0145, house0146,
//                                                     team0145 ×2
//   a single JSON blob ....... house0116
//   plain text from a .mjs ... house0132, proj0092, team0135, team0137,
//                              grant0093, team0143
//
// On 2026-08-12 a session tried to check them all with an ad-hoc parser and
// reported "0/23 FAIL" on a proof that was fully green, then reported four more
// as N-1/N because it counted each file's own summary row as a failure. Two
// false alarms in a row. A verification step that cries wolf gets ignored, and
// this repo has already written that down twice
// (docs/mistakes/tooling-proofs.md).
//
// THE PROPERTY THAT MATTERS: an output this cannot interpret is reported as
// UNKNOWN and exits non-zero. It must never score "I could not read this" as a
// pass — that is the failure mode every guard here has been bitten by.
//
//   node tools/run-proofs.mjs            # all of them
//   node tools/run-proofs.mjs team       # only proofs whose name matches
// ============================================================
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadEnv, resolveTarget } from './env-lib.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every proof STATE.md claims coverage from. Adding one here is the point. */
const PROOFS = [
  ['authz-sweep-identity.sql', 'the identity boundary for anon AND an ungranted student'],
  ['pr0149-delete-permission.sql', 'PR delete: the RPC must agree with the policy'],
  ['shop0150-buyer-contact.sql', 'what a buyer may change on their own order'],
  ['house0116-authz.sql', 'ระบบบ้าน read boundary'],
  ['house0144-delete-impact.sql', 'the delete dialog predicts what a delete does'],
  ['house0145-duplicate-person.sql', 'a second placement links, never duplicates'],
  ['house0146-crest-refcount.sql', 'the crest refcount can see the crest'],
  ['team0145-one-chan-pi.sql', 'ชั้นปี survives a registry touch'],
  ['team0145-save-as-the-member.sql', 'saving as the member keeps the mirror'],
  ['claude0154-quota-guard.sql', 'the Claude quota caps hold, and the board is gated'],
  ['claude0155-free-now.sql', 'how much Claude quota may be used right now, and until when'],
  ['claude0157-rail-segments.sql', "the calendar rail's bands are constant and its edges are deadlines"],
  ['claude0159-window-share.sql', 'a 5-hour Claude window is shared by everyone it covers'],
  ['claude0161-rail-guard-parity.sql', 'the calendar rail and the booking guard derive the SAME window'],
  ['claude0162-usage-runs.sql', 'ใช้จริง says WHEN Claude was used, from the window\'s own opening instant'],
  ['claude0167-monitoring-switch.sql', 'a "right now" measurement expires, and an admin can switch it off'],
  ['proj0165-succession-and-prefs.sql', 'the seat reaches what the retired role account reached; ปีงบ + prefs boundaries'],
  ['passport0180-season-gate.sql', "a QR scans while its quarter is open, and not after"],
  ['passport0174-total-km-symmetry.sql', 'a passport total moves DOWN as well as up'],
  ['passport-link-on-signup.sql', 'a carried student keeps their km, and a re-key that gives up is VISIBLE'],
  ['proj0176-master-desk.sql', 'a master works the ผู้ส่ง desk, and the professor guard still guards'],
  ['dept0177-page-scope.sql', 'a ฝ่าย edits its OWN page and nobody else\'s'],
  ['dept0179-kinds.sql', 'each ฝ่าย content kind carries the body it renders'],
  ['proj0181-prof-upload.sql', 'an อาจารย์ saves a signed file on a หนังสือ that is NOT published'],
  ['passport0182-continents-lockdown.sql', 'the anon key reads the passport theming and cannot change it'],
  ['authz0182-insert-returning-seam.sql', 'an INSERT that asks for the row back can read what it wrote'],
  ['team0183-discord-mapping.sql', 'a Discord identity is not shareable and two same-named ตำแหน่ง cannot claim one role'],
  ['pass-hardening.mjs', 'passport RLS: five real principals, 0011 applied in a rolled-back txn'],
  ['house0132-registry.mjs', 'public.people is the registry'],
  ['proj0092-seat-parity.mjs', 'project seats resolve identically both ways'],
  ['team0135-name-split.mjs', 'name splitting round-trips'],
  ['team0137-search.mjs', 'search_people boundary'],
  ['grant0093-reads.mjs', 'a grant channel reaches the READS too'],
  ['team0143-photo-refcount.mjs', 'portrait refcount'],
  // Not a database proof — the repo's own branch protection, which lives on
  // GitHub OUTSIDE git, so nothing else in this repo notices if it is switched
  // off. Needs `gh` authenticated, like the rest of this runner needs a PAT.
  ['repo-protection.mjs', 'branch protection is still enforcing'],
  // Also not a database proof: can anything OUTSIDE the VM fire a real
  // notification? Cloudflare freezes env vars into each deployment, so this
  // reads every deployment's baked-in env — the project's current config says
  // nothing about what an existing deployment will do.
  ['notify-exposure.mjs', 'only the VM can reach a real notification channel'],
];

// ⛔ PROOFS IS A HARDCODED LIST, AND A HARDCODED LIST ROTS SILENTLY.
//
// Found 2026-09-04: passport0180-season-gate.sql was written, run by hand
// against dev AND production, committed — and never ran here, because adding
// the file is not the same as adding the line. `npm run proofs` reported "all
// 30 proofs green" exactly as before, so the number that is supposed to be the
// evidence was the thing hiding it. This is the same shape as the mistakes
// index found the same day (its TOPICS list ignored a new file), and it is
// class 7: a guard whose SUBJECT is a hardcoded name.
//
// The directory is the authority for what exists. Every tools/*.sql is a proof;
// there is no other kind of .sql in there. So an unlisted one is an error, and
// a listed-but-missing one is a rename nobody finished.
{
  const onDisk = readdirSync(HERE)
    .filter((f) => f.endsWith('.sql')).sort();
  // ⚠️ .sql ONLY, in both directions. PROOFS also holds .mjs proofs, and tools/
  // is full of .mjs that are NOT proofs (apply-migration, db-query, …) — so the
  // directory can only be the authority for the one extension where every file
  // is a proof. The first version of this guard compared every listed entry
  // against the .sql listing and declared all eight .mjs proofs missing.
  const listed = new Set(PROOFS.map(([f]) => f).filter((f) => f.endsWith('.sql')));
  const unlisted = onDisk.filter((f) => !listed.has(f));
  const missing = [...listed].filter((f) => !onDisk.includes(f));
  if (unlisted.length || missing.length) {
    if (unlisted.length) {
      console.error(`✗ tools/ holds ${unlisted.join(', ')} with no entry in PROOFS.`);
      console.error('  A proof nobody runs is not a proof. Add the line above.');
    }
    if (missing.length) {
      console.error(`✗ PROOFS names ${missing.join(', ')}, which is not on disk.`);
    }
    process.exit(1);
  }
}

/**
 * The two proofs above that ask GitHub and Cloudflare, not a database.
 *
 * They are listed separately because `--dev` must SKIP them EXPLICITLY. A
 * dev-targeted run has nothing to say about the repo's branch protection or
 * about which Cloudflare deployment holds a real webhook — those are global
 * facts with one answer. Running them anyway would report the PRODUCTION
 * answer inside a run labelled samo-dev, which is the same confusion this
 * whole change exists to remove; silently dropping them would be worse still,
 * because the summary would shrink with no reason given.
 */
const NON_DB = new Set(['repo-protection.mjs', 'notify-exposure.mjs']);

/**
 * WHERE THIS RUN POINTS, and the guard that makes the answer trustworthy.
 *
 * Measured 2026-08-29: `VITE_SUPABASE_URL=$SUPABASE_DEV_URL npm run proofs`
 * sent the 17 `.sql` proofs to samo-dev and `proj0092-seat-parity.mjs` +
 * `grant0093-reads.mjs` to PRODUCTION, then printed one green summary over the
 * mixture. Both files now read their target through env-lib, but a FIX in two
 * files is not a mechanism — the next proof written by hand can reintroduce it.
 *
 * So the runner does not trust them. Every database proof announces its target
 * on stderr (`→ project: <ref>`), and this reads that line back and FAILS the
 * proof if the ref is not the one it was SENT to. A proof that announces
 * nothing is UNKNOWN, never PASS: "I cannot tell which database answered" is
 * exactly the state this file was written to stop scoring as success.
 */
const wantDev = process.argv.includes('--dev');
const loaded = loadEnv();
const childEnv = { ...process.env };
if (wantDev) {
  const url = loaded.env.SUPABASE_DEV_URL;
  const tok = loaded.env.SUPABASE_DEV_ACCESS_TOKEN;
  if (!url || !tok) {
    console.error('--dev needs SUPABASE_DEV_URL + SUPABASE_DEV_ACCESS_TOKEN '
      + '(in .env.local, or the environment in CI)');
    process.exit(2);
  }
  childEnv.VITE_SUPABASE_URL = url;
  childEnv.SUPABASE_ACCESS_TOKEN = tok;
}
const TARGET = resolveTarget({ ...loaded, env: { ...loaded.env, ...childEnv } });
if (!TARGET.ref) {
  console.error('no VITE_SUPABASE_URL — nothing to run proofs against');
  process.exit(2);
}
if (wantDev && !TARGET.isDev) {
  // The label is derived by comparing refs, so this catches a SUPABASE_DEV_URL
  // that points somewhere other than samo-dev — including at production.
  console.error(`--dev resolved to ${TARGET.ref} (${TARGET.label}), which is not samo-dev`);
  process.exit(2);
}
console.log(`→ target: ${TARGET.ref}  (${TARGET.label})\n`);

/**
 * Decide a proof's verdict from its stdout.
 * @returns {{ state: 'PASS'|'FAIL'|'UNKNOWN', detail: string }}
 */
function judge(file, out) {
  if (file.endsWith('.mjs')) {
    const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/i);
    if (m) {
      return Number(m[2]) === 0
        ? { state: 'PASS', detail: `${m[1]}/${Number(m[1]) + Number(m[2])}` }
        : { state: 'FAIL', detail: `${m[2]} failed` };
    }
    if (/all\s+\d*\s*pass/i.test(out)) return { state: 'PASS', detail: 'all pass' };
    if (/\bFAIL\b|✗|✘/.test(out)) return { state: 'FAIL', detail: 'FAIL in output' };
    return { state: 'UNKNOWN', detail: 'no recognised summary line' };
  }

  let rows;
  try { rows = JSON.parse(out); } catch { return { state: 'UNKNOWN', detail: 'stdout is not JSON' }; }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { state: 'UNKNOWN', detail: 'no rows' };
  }

  // Single-blob proofs (house0116): no per-case column to read, so fall back to
  // scanning the text — and say so, rather than implying per-case coverage.
  const key = ['verdict', 'status', 'result'].find(
    (k) => k in rows[0] && typeof rows[0][k] === 'string' && rows[0][k].length < 40,
  );
  if (!key) {
    const text = JSON.stringify(rows);
    if (/FAIL|DENIED_UNEXPECTED/i.test(text)) return { state: 'FAIL', detail: 'FAIL in blob' };
    return { state: 'PASS', detail: 'blob, no FAIL marker (not per-case)' };
  }

  // A trailing "ALL PASS"/SCORE row is a SUMMARY, not a case — counting it as a
  // case is what produced the false N-1/N reports this tool exists to prevent.
  const cases = rows.filter((r) => !/^ALL\s+PASS$/i.test(String(r[key])));
  const summary = rows.find((r) => /^ALL\s+PASS$/i.test(String(r[key])));
  const passed = cases.filter((r) => String(r[key]).toUpperCase().startsWith('PASS'));
  const failed = cases.filter((r) => !String(r[key]).toUpperCase().startsWith('PASS'));

  if (failed.length) {
    const first = failed[0];
    const label = first.step || first.name || first.case || JSON.stringify(first).slice(0, 60);
    return { state: 'FAIL', detail: `${failed.length} failed — ${label}` };
  }
  return {
    state: 'PASS',
    detail: `${passed.length}/${cases.length}${summary ? ' (+summary)' : ''}`,
  };
}

const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const chosen = PROOFS.filter(([f]) => !filter || f.includes(filter));
if (chosen.length === 0) {
  console.error(`no proof matches "${filter}"`);
  process.exit(2);
}

/**
 * EVERY project a proof says it queried, from its own announcements on stderr.
 *
 * ⚠️ Returns all of them, not the first. Reading only the first would let a
 * proof that queried dev and THEN production pass on the strength of its
 * opening line — narrower than the guarantee this check is supposed to give.
 * No proof does that today (measured 2026-08-29: all six .mjs proofs announce
 * exactly once), which is precisely why it would go unnoticed if one started.
 */
export function announcedRefs(text) {
  return [...String(text).matchAll(/→ project:\s*([a-z0-9]+)/g)].map((m) => m[1]);
}

let bad = 0;
let skipped = 0;
for (const [file, what] of chosen) {
  if (wantDev && NON_DB.has(file)) {
    skipped += 1;
    console.log(`${file.padEnd(34)}– SKIP    asks GitHub/Cloudflare, not a database   — ${what}`);
    continue;
  }
  process.stdout.write(`${file.padEnd(34)}`);
  const r = file.endsWith('.mjs')
    ? spawnSync('node', [join(HERE, file)], { encoding: 'utf8', env: childEnv })
    : spawnSync('node', [join(HERE, 'db-query.mjs'), join(HERE, file)], { encoding: 'utf8', env: childEnv });

  let verdict;
  if (r.error || r.status !== 0) {
    // A proof that ERRORS is absent, not passing (docs/mistakes/tooling-proofs.md).
    const why = String(r.error?.message || r.stderr || '').trim().slice(0, 90);
    verdict = { state: 'FAIL', detail: `errored: ${why}` };
  } else {
    verdict = judge(file, r.stdout);
    // Only NOW ask where it went. A proof that passed against the wrong
    // database has told you nothing about the one you asked about.
    if (!NON_DB.has(file)) {
      const said = announcedRefs(`${r.stderr}\n${r.stdout}`);
      const wrong = [...new Set(said.filter((x) => x !== TARGET.ref))];
      if (!said.length) {
        verdict = { state: 'UNKNOWN', detail: 'did not announce which project it queried' };
      } else if (wrong.length) {
        verdict = { state: 'FAIL', detail: `ran against ${wrong.join(', ')}, not ${TARGET.ref}` };
      }
    }
  }

  if (verdict.state !== 'PASS') bad += 1;
  const mark = { PASS: '✓', FAIL: '✗', UNKNOWN: '?' }[verdict.state];
  console.log(`${mark} ${verdict.state.padEnd(7)} ${verdict.detail}   — ${what}`);
}

const ran = chosen.length - skipped;
const tail = skipped ? ` (${skipped} skipped — not database proofs)` : '';
console.log(bad === 0
  ? `\nall ${ran} proofs green against ${TARGET.ref}${tail}`
  : `\n${bad} of ${ran} proofs NOT green against ${TARGET.ref}${tail} — an UNKNOWN counts, on purpose`);
process.exit(bad === 0 ? 0 : 1);
