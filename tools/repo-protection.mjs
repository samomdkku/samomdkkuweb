#!/usr/bin/env node
// ============================================================
// repo-protection.mjs — are the branch-protection settings still ON?
//
//   node tools/repo-protection.mjs          (part of `npm run proofs`)
//
// WHY THIS EXISTS. On 2026-08-27 `main` was set to require the `build` check
// and code-owner review. **Those settings live on GitHub, outside git.** Turn
// them off and nothing goes red: the tests still pass, the site still works,
// and every contributor rule written that day silently becomes advisory. The
// whole ฝ่าย-contribution design (docs/DEPT-TOOLS.md) rests on them.
//
// BOTH DIRECTIONS. Two of the assertions below are "must be ON" and two are
// "must stay OFF" — `enforce_admins` in particular MUST remain false, because
// it is what lets the owner push `main`, which is this repo's normal flow
// (CLAUDE.md authority model). A proof that only checks the ON half would
// happily pass a configuration that had locked the owner out of their own repo.
//
// Reads from the AUTHORITY — the GitHub API — never from a local file that
// merely describes the intent.
// ============================================================

import { execFileSync } from 'node:child_process';
import { SLUG, OWNER, REPO_NAME, SIBLING_REPOS } from './repo-identity.mjs';
import { loadEnv } from './env-lib.mjs';

// SLUG comes from package.json's `repository.url` — the ONE home for this
// repo's identity (tools/repo-identity.mjs). Overridable for a fork.
const REPO = process.env.SAMO_REPO || SLUG;
const BRANCH = process.env.SAMO_BRANCH || 'main';

let p;
try {
  p = JSON.parse(execFileSync('gh',
    ['api', `repos/${REPO}/branches/${BRANCH}/protection`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (e) {
  console.log(`✗ could not read protection for ${REPO}@${BRANCH}: ${String(e.stderr || e.message).trim().slice(0, 160)}`);
  console.log('\n1 FAILED');
  console.log('  A 404 here does not mean "fine" — it means protection is GONE.');
  process.exit(1);
}

const checks = [
  ['CI blocks a merge',
    (p.required_status_checks?.contexts || []).includes('build'), true,
    'a pull request with the whole suite red would be mergeable'],
  ['code-owner review blocks',
    p.required_pull_request_reviews?.require_code_owner_reviews, true,
    'CODEOWNERS would only REQUEST the owner; any collaborator could approve auth.js'],
  ['at least one approval required',
    (p.required_pull_request_reviews?.required_approving_review_count ?? 0) >= 1, true,
    'anything could merge unreviewed'],
  ['force-push blocked',
    p.allow_force_pushes?.enabled, false,
    'history could be rewritten under everyone'],
  ['branch deletion blocked',
    p.allow_deletions?.enabled, false,
    'main could be deleted'],
  // The OFF half. Deliberate, and re-asserted so nobody "tidies" it on.
  ['enforce_admins stays OFF',
    p.enforce_admins?.enabled, false,
    'the OWNER could no longer push main — it is what makes their normal flow work, '
    + 'and it is the escape hatch when their own PR cannot self-approve'],
];

// ---------------------------------------------------------------------------
// RULESETS — the OTHER enforcement path, and the one that actually refused a
// push on 2026-08-31.
//
// Everything above reads `branches/main/protection`, the CLASSIC API. GitHub
// has a second, newer mechanism — rulesets — which enforces INDEPENDENTLY and
// does not appear there at all. This repo has carried an active `main-protect`
// ruleset since 2026-05-23, so for three months these six checks were passing
// while describing only half of the gate.
//
// What it cost. Transferring the repo into the `samomdkku` organisation
// silently emptied that ruleset's `bypass_actors` — four of them, including
// `RepositoryRole: 5` (admin), which is what lets the owner push `main`. The
// classic `enforce_admins stays OFF` check above still reported ✓, because the
// thing it reads was genuinely untouched. The next `git push` was refused with
// GH013, and nothing in this file could explain why.
//
// So both halves are asserted, and the bypass is asserted BY PROPERTY — "an
// admin can still push" — not by re-listing whatever is configured today.
// ---------------------------------------------------------------------------
let rulesets = null;
try {
  const list = JSON.parse(execFileSync('gh',
    ['api', `repos/${REPO}/rulesets`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  rulesets = list.map((r) => JSON.parse(execFileSync('gh',
    ['api', `repos/${REPO}/rulesets/${r.id}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })));
} catch (e) {
  // An unreachable API is UNKNOWN, never PASS — same rule as Cloudflare below.
  checks.push(['rulesets readable',
    `unreachable: ${String(e.stderr || e.message).trim().slice(0, 60)}`, 'yes',
    'could not ask GitHub for rulesets; this is not evidence that they are fine']);
}

if (rulesets) {
  const governsMain = (r) => {
    const inc = r.conditions?.ref_name?.include ?? [];
    return inc.includes('refs/heads/main') || inc.includes('~DEFAULT_BRANCH') || inc.includes('~ALL');
  };
  const active = rulesets.filter((r) => r.enforcement === 'active' && governsMain(r));

  // Guard the guard. If someone deletes the ruleset, the bypass assertion
  // below would pass over an empty list — this repo's most-paid-for test
  // failure. Assert the subject EXISTS before asserting anything about it.
  checks.push(['a ruleset governs main',
    active.length > 0, true,
    'the branch is protected only by the classic API — whoever removed the ruleset '
    + 'may have believed the six checks above covered it, and they do not']);

  const adminCanPush = active.every((r) => (r.bypass_actors ?? []).some(
    (a) => a.actor_type === 'RepositoryRole' && a.actor_id === 5 && a.bypass_mode === 'always'));
  checks.push(['admin can still push main (ruleset bypass)',
    active.length > 0 ? adminCanPush : 'no ruleset to check', true,
    'the owner\'s direct push to `main` is REFUSED with GH013 — this repo\'s normal '
    + 'flow (CLAUDE.md authority model), and the escape hatch when their own PR cannot '
    + 'self-approve. A repository TRANSFER empties bypass_actors silently; re-add '
    + 'RepositoryRole 5 (admin) with bypass_mode always']);
}

// ---------------------------------------------------------------------------
// The SECOND place this repo's owner is written down, and it is not in git.
//
// Cloudflare Pages binds the preview builder to `source.config.owner` +
// `repo_name` in ITS OWN config. A repository transfer does not follow: the
// project keeps pointing at the old path, per-PR previews simply STOP being
// built, and nothing in this repository goes red — the pull request just never
// gets a preview comment, which looks like Cloudflare being slow.
//
// This project is moving to an organisation account, so that day is coming.
// Reading it here turns an invisible outside-git fact into a failing proof.
// ---------------------------------------------------------------------------
const { env } = loadEnv();
const cfAccount = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const cfToken = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

if (cfAccount && cfToken) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects/${REPO_NAME}`,
      { headers: { Authorization: `Bearer ${cfToken}` } });
    const body = await res.json();
    const src = body?.result?.source?.config ?? {};
    checks.push(
      ['Cloudflare previews still point at this repo',
        `${src.owner}/${src.repo_name}`, `${OWNER}/${REPO_NAME}`,
        'the Pages project builds a repository that is no longer this one — per-PR '
        + 'previews stop, silently, and no test in this repo can see it. Reconnect the '
        + 'project (and install the Cloudflare GitHub App on the new account).'],
    );

    // -----------------------------------------------------------------
    // WHICH DATABASE A pages.dev COPY TALKS TO. Paid for on 2026-08-31.
    //
    // Cloudflare builds `main` as a PRODUCTION deployment, and that
    // environment's env vars named the REAL Supabase project. So
    // <hash>.samomdkkuweb.pages.dev served a fully working app wired to live
    // student data — while `ribbonLabel` showed it an orange PREVIEW ribbon,
    // because no VITE_ENV_NAME was set and the host ends in .pages.dev. The
    // instrument that exists to say "this is not real" said the opposite of
    // the truth, in the dangerous direction. It surfaced only because signing
    // in there bounced to samo.md.kku.ac.th (the prod site_url fallback).
    //
    // The property, not the settings: NOTHING on pages.dev may reach the
    // production database. Asserted against SUPABASE_DEV_URL rather than a
    // hardcoded ref, which would rot the first time a project is recreated.
    // -----------------------------------------------------------------
    const devUrl = env.SUPABASE_DEV_URL || process.env.SUPABASE_DEV_URL;

    if (!devUrl) {
      console.log('– Cloudflare database check SKIPPED: no SUPABASE_DEV_URL in '
        + '.env.local. It is what "not production" is measured against.');
    } else {
      // ⚠️ THIS CHECK USED TO NAME ONE PROJECT, AND THAT IS WHY IT PASSED.
      // Written 2026-08-31 against `REPO_NAME`, it reported all-green on
      // 2026-09-01 while the account held THREE Pages projects and the other
      // two were both wired to a database that is not samo-dev — one of them
      // to the LIVE production project, with a production anon key and no
      // VITE_ENV_NAME, which is the exact configuration this guard was written
      // to catch. The property is "NOTHING on pages.dev may reach the
      // production database": it is a statement about the ACCOUNT, so the
      // guard has to enumerate the account. A guard built from the same list
      // as the fix can only ever confirm the fix.
      const list = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects`,
        { headers: { Authorization: `Bearer ${cfToken}` } }).then((r) => r.json());
      const projects = list?.result ?? [];

      checks.push(['Cloudflare: the project list is readable',
        projects.length > 0, true,
        'could not enumerate Pages projects; a guard that sees nothing must not pass']);

      for (const proj of projects) {
        const pcfg = proj?.deployment_configs ?? {};
        for (const e of ['production', 'preview']) {
          const vars = pcfg[e]?.env_vars ?? {};
          // ⛔ THIS ONCE READ "Unset is SAFE — a build with no Supabase URL reaches
          // no database", and that was true of the app it was written against and
          // FALSE of the one beside it. samoweb's src/js/db.js reads
          // import.meta.env.VITE_SUPABASE_URL with no fallback, so unset really does
          // reach nothing. samomdkkupassport's js/app.js does
          //     import.meta.env?.VITE_SUPABASE_URL || "https://fheueuowbchsnsvbcgil…"
          // — the PRODUCTION project, hardcoded, with the production anon key beside
          // it. There, unset means PRODUCTION. So deleting a variable would have
          // pointed a preview at real student data and this guard would have called
          // it a PASS, which is the failure mode the whole check exists to prevent.
          //
          // The fix is not to special-case passport: an assumption about what a
          // MISSING value falls back to is a fact about code in another repository,
          // which this file cannot see and which can change without it. So require
          // the variable to be SET and to name samo-dev. That is true of every
          // project today, it needs no knowledge of any app's fallback, and a
          // deleted variable now goes RED instead of silently green.
          const url = vars.VITE_SUPABASE_URL?.value;
          checks.push([`Cloudflare ${proj.name}/${e} is pinned to the dev database`,
            url === devUrl, true,
            url === undefined
              ? 'VITE_SUPABASE_URL is UNSET. That is not neutral: an app that falls back '
                + 'to a hardcoded URL (samomdkkupassport/js/app.js does, to PRODUCTION) '
                + 'will reach that database instead. Set it with `npm run cf:pin-dev`.'
              : `VITE_SUPABASE_URL is ${url}. A pages.dev build made from this config talks `
                + `to a database that is not samo-dev. If it is the production project, every `
                + `form submitted there writes REAL student data while the page shows a `
                + `PREVIEW ribbon. Repoint it (npm run cf:pin-dev) or delete the project.`]);

          const nm = vars.VITE_ENV_NAME?.value;
          checks.push([`Cloudflare ${proj.name}/${e} labels itself non-production`,
            nm !== undefined && nm !== 'production', true,
            `VITE_ENV_NAME is ${nm ?? '(unset)'}. Unset makes the ribbon guess from the `
            + `hostname, which is how a production-data deployment came to display `
            + `"PREVIEW".`]);
        }
      }
    }
  } catch (e) {
    // An unreachable API is UNKNOWN, never PASS.
    checks.push(['Cloudflare previews still point at this repo',
      `unreachable: ${String(e.message).slice(0, 60)}`, `${OWNER}/${REPO_NAME}`,
      'could not ask Cloudflare; this is not evidence that it is fine']);
  }
} else {
  console.log('– Cloudflare owner check SKIPPED: no CLOUDFLARE_ACCOUNT_ID / '
    + 'CLOUDFLARE_API_TOKEN in .env.local. After a repo transfer, run this WITH them.');
}

// ---------------------------------------------------------------------------
// THE SIBLING REPO. Added 2026-08-31, when `maintainers` was granted write on
// `samomdkkupassport` and it turned out to have NO protection at all: no
// branch protection, no ruleset, no CODEOWNERS, no CI. Five people could push
// straight to the app students scan QR codes with.
//
// Its expectations are deliberately NOT this repo's. It has no workflows, so
// requiring a status check would leave every pull request waiting for a report
// that never comes — `main` sat red for a day here once and silently blocked
// every contributor (src/js/ci-workflows.test.js). And it has no CODEOWNERS,
// so `require_code_owner_reviews` would require nothing while reading like a
// rule.
//
// The last check is the one worth having: it does not assert today's
// configuration, it asserts the REASONING — a required status check is only
// legitimate once something exists to report it.
// ---------------------------------------------------------------------------
// ⚠️ SAY WHEN THIS SECTION IS INERT. `SIBLING_REPOS` is deliberately empty (the
// passport repo is archived; repo-identity.mjs explains why), so both loops
// below iterate nothing and the script still prints "all N pass". That is
// correct, and it took a later reader four commands to establish — the count
// dropped from 27 to 18 and nothing in the OUTPUT said why. A guard whose
// subject list is empty must say so out loud, or its silence reads as coverage.
if (SIBLING_REPOS.length === 0) {
  console.log('— sibling-repo checks: none to run (SIBLING_REPOS is empty by '
    + 'design — the passport repo is archived; see tools/repo-identity.mjs)');
}

for (const name of SIBLING_REPOS) {
  const sib = `${OWNER}/${name}`;
  let sp;
  try {
    sp = JSON.parse(execFileSync('gh', ['api', `repos/${sib}/branches/main/protection`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    // A 404 here does not mean "fine" — it means protection is GONE.
    checks.push([`${name}: main is protected`,
      `unprotected (${String(e.stderr || e.message).trim().slice(0, 40)})`, true,
      'anyone with write can push straight to main on a repo students depend on']);
    continue;
  }

  const reviews = sp.required_pull_request_reviews;
  checks.push([`${name}: a pull request is required`,
    (reviews?.required_approving_review_count ?? 0) >= 1, true,
    'a team member can push to main unreviewed']);
  checks.push([`${name}: force-push blocked`, sp.allow_force_pushes?.enabled, false,
    'history could be rewritten under everyone']);
  checks.push([`${name}: branch deletion blocked`, sp.allow_deletions?.enabled, false,
    'main could be deleted']);
  checks.push([`${name}: enforce_admins stays OFF`, sp.enforce_admins?.enabled, false,
    'the owner could no longer push main — the escape hatch when their own PR '
    + 'cannot self-approve, and they are often the only reviewer']);

  // A required check with nothing to report it blocks every PR for ever.
  const required = sp.required_status_checks?.contexts ?? [];
  let hasCI = true;
  try {
    execFileSync('gh', ['api', `repos/${sib}/contents/.github/workflows`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { hasCI = false; }
  checks.push([`${name}: no required check without CI to report it`,
    required.length === 0 || hasCI, true,
    `main requires ${JSON.stringify(required)} but the repo has no workflows — every `
    + 'pull request waits for a status that never arrives. Add the workflow first, '
    + 'or drop the requirement']);
}

// ---------------------------------------------------------------------------
// THE SIBLING'S HOST GUARD. Added 2026-09-04, when the passport preview work
// turned it up.
//
// Every built passport entry carries an inline "deprecated host" redirect. It
// tested `/\.pages\.dev$/i` — ANY pages.dev host — which is ALSO every preview
// URL, because previews live on pages.dev too. So the moment
// `preview.samomdkkupassport.pages.dev` existed it would bounce ITSELF to a
// splash pointing at PRODUCTION: a tester aiming at the dev database would land
// on the real site, having been told the preview was the safe place to click.
// samomdkkuweb narrowed the identical guard on 2026-08-27; the sibling did not
// get that fix for eight days, because ONE RULE WITH AN IMPLEMENTATION PER REPO
// HAS NO SHARED GUARD. This is that guard.
//
// It is asserted from OUTSIDE, over the GitHub API, for a reason: the sibling
// has no test runner and adding one is a bigger change than the bug. So the
// repo that HAS tooling checks the repo that does not.
//
// ⛔ IT READS THE EXECUTABLE LINE, NEVER THE FILE TEXT. The fixed index.html
// quotes the OLD broken regex inside its explanatory comment, so a plain
// `includes('/\\.pages\\.dev$/')` over the file matches the COMMENT and reports
// the bug still present on a correct file. (This repo has already paid for a
// proof satisfied by prose — confirm-modal.test.js matched a comment.) Only
// lines that actually run — the ones calling `.test(location.hostname)` — are
// examined, and a control asserts we found some, so an empty scan is RED
// rather than silently green.
// ---------------------------------------------------------------------------
const GUARDED_ENTRIES = ['index.html', 'html/dashboard.html', 'html/admin.html', 'html/scan.html'];
for (const name of SIBLING_REPOS) {
  const sib = `${OWNER}/${name}`;
  let examined = 0;
  const broad = [];
  let readable = true;

  for (const entry of GUARDED_ENTRIES) {
    let html;
    try {
      const raw = execFileSync('gh', ['api', `repos/${sib}/contents/${entry}`, '--jq', '.content'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      html = Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch {
      // A missing entry is not a pass. If the file list here goes stale
      // (a renamed entry), say so rather than scoring zero findings as green.
      readable = false;
      continue;
    }
    // Only lines that RUN. The comment above explains why this matters.
    for (const line of html.split('\n')) {
      if (!line.includes('.test(location.hostname)')) continue;
      examined += 1;
      if (!/\^samomdkkupassport\\?\.pages\\?\.dev\$/.test(line)) broad.push(`${entry}: ${line.trim().slice(0, 90)}`);
    }
  }

  checks.push([`${name}: every host guard is ANCHORED to the one retired host`,
    broad.length === 0 && readable, true,
    broad.length
      ? 'these run on EVERY pages.dev host, so the preview bounces itself to a '
        + `splash pointing at production:\n      ${broad.join('\n      ')}`
      : `could not read all of ${JSON.stringify(GUARDED_ENTRIES)} from ${sib} — the entry `
        + 'list may be stale; a scan that finds nothing must not read as a pass']);

  // The CONTROL. Without it, a rename or an API change makes `broad` empty and
  // the check above passes while having inspected nothing at all.
  checks.push([`${name}: the guard scan actually found guards to check`,
    examined >= GUARDED_ENTRIES.length, true,
    `only ${examined} executable host-guard line(s) found across `
    + `${GUARDED_ENTRIES.length} entries — expected at least one each. The scan is `
    + 'blind; fix it before trusting the check above']);
}

let failed = 0;
for (const [name, got, want, consequence] of checks) {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}: expected ${want}, got ${got}`
    + (ok ? '' : `\n    → ${consequence}`));
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${checks.length} pass`);
process.exit(failed ? 1 : 0);
