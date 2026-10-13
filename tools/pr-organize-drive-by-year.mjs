#!/usr/bin/env node
// ============================================================
// pr-organize-drive-by-year.mjs — one-shot mover: sort PR attachments that
// were uploaded into the flat `My Drive/IT Database/PR/` folder (before
// 0220) into `PR/<samo_year_be>/`, matching the year the DATABASE already
// says each ticket belongs to.
//
// DRY RUN BY DEFAULT. Nothing moves without --apply, and --apply must carry
// the exact count the dry run just printed — the same "an --apply that
// recomputes and proceeds is an --apply that can do something nobody ever
// saw" contract every other write-capable tool in this directory uses
// (tools/discord-apply.mjs, tools/discord-provision.mjs).
//
//   node tools/pr-organize-drive-by-year.mjs                  # plan only
//   node tools/pr-organize-drive-by-year.mjs --apply --move N # execute
//
// NEVER TRASHES TO MOVE. It calls the GAS action `movePRFileToYear`
// (appscript/prform.gs), which uses Drive's `moveTo()` — same file id, same
// "anyone with the link" sharing, just a different parent. A trashed Drive
// file is STILL PUBLIC (lh3 resolves it, HTTP 200) and would also orphan
// every `pr_tickets.file_url` already pointing at the old id — moveTo has
// neither problem (memory: trashed-drive-file-still-public).
//
// WHAT THIS CANNOT SEE: whether a file is ALREADY under PR/<year> (it only
// reads pr_tickets, never lists Drive first) — re-running this after a
// partial apply re-plans every attachment again, and `moveTo()` into a
// folder a file is already in is a harmless no-op, just a wasted GAS call.
// Prefer running it ONCE, to completion, over re-running it repeatedly.
//
// WHAT IT SKIPS, on purpose: a ticket with `samo_year_be` still NULL (should
// not exist for any row that predates 0220 — the migration backfills every
// one — but a future row inserted with the trigger somehow bypassed would
// have nowhere to file), and a "ลิงก์เสริม" (a submitter-pasted link, which
// may not even be a Drive file this account owns — moving someone else's
// file is not this tool's business, only parsePrAttachments' own "image"
// kind, i.e. what uploadPRFile itself wrote, qualifies).
//
// PACED — THIS HITS THE SAME PUBLIC /exec ENDPOINT REAL UPLOADS SHARE.
// Calling it hard degrades the GAS endpoint for whoever is submitting a PR
// ticket right now (measured in proj0183-drive-orphans.mjs's header: rapid
// calls get Google's HTML "ไม่สามารถเปิดไฟล์ได้" page instead of JSON). Run
// this when traffic is low, never in a loop, and prefer the default pace.
// ============================================================
import { readFileSync } from 'node:fs';
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';
import { parsePrAttachments } from '../src/js/pr-attachments.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const moveIdx = args.indexOf('--move');
const EXPECT_MOVE = moveIdx !== -1 ? Number(args[moveIdx + 1]) : null;
const PACE_MS = Number(process.env.PR_MOVE_PACE_MS) || 2500;

/**
 * Pure: rows (from pr_tickets) → the plan (one entry per Drive attachment to
 * move). Exported so pr-organize-drive-by-year.test.js can assert this
 * without a database or a Drive credential.
 */
export function buildMovePlan(rows) {
  const plan = [];
  for (const row of rows || []) {
    if (row.samo_year_be == null) continue;
    for (const att of parsePrAttachments(row.file_url)) {
      if (att.kind !== 'image') continue;
      if (!/drive\.google\.com|googleusercontent\.com/.test(att.url)) continue;
      plan.push({ ticketId: row.id, year: Number(row.samo_year_be), url: att.url });
    }
  }
  return plan;
}

async function main() {
  const target = announceTarget(loadEnv());

  const GAS = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8')
    .match(/GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
  if (!GAS) { console.error('could not read GAS_API_URL from src/js/config.js'); process.exit(2); }

  const body = await runSql(
    `select id, file_url, samo_year_be from public.pr_tickets
      where file_url is not null and file_url <> '' order by id`,
    target,
  );
  const rows = JSON.parse(body);
  if (!Array.isArray(rows)) { console.error('unexpected query result:', body.slice(0, 300)); process.exit(2); }

  const plan = buildMovePlan(rows);
  const byYear = new Map();
  for (const p of plan) byYear.set(p.year, (byYear.get(p.year) || 0) + 1);

  console.log(`\n${plan.length} attachment(s) across ${new Set(plan.map((p) => p.ticketId)).size} ticket(s) would move into PR/<year>/:\n`);
  for (const [year, count] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  PR/${year}: ${count} file(s)`);
  }

  if (!APPLY) {
    console.log(plan.length === 0
      ? '\nNothing to move.'
      : `\nPLAN ONLY — nothing moved.\n  node tools/pr-organize-drive-by-year.mjs --apply --move ${plan.length}`);
    return;
  }
  if (EXPECT_MOVE !== plan.length) {
    console.error(`\n⛔ REFUSED — --move ${EXPECT_MOVE} does not match the current plan of ${plan.length}.`);
    console.error('The data changed since the dry run (or you have not run one). Re-run without --apply and pass the NEW count.');
    process.exit(1);
  }
  if (plan.length === 0) { console.log('\nNothing to move.'); return; }

  console.log(`\nMoving ${plan.length} file(s), paced ${PACE_MS}ms apart — this takes a while on purpose.\n`);
  let moved = 0;
  let failed = 0;
  for (const p of plan) {
    const res = await postToGas(GAS, { action: 'movePRFileToYear', fileUrl: p.url, year: String(p.year) });
    if (res?.success) {
      moved++;
      console.log(`  ✓ ${p.ticketId} → PR/${p.year}`);
    } else {
      failed++;
      console.error(`  ✗ ${p.ticketId}: ${res?.message || 'no JSON reply from GAS (rate-limited interstitial?)'}`);
    }
    await sleep(PACE_MS);
  }
  console.log(`\n${moved} moved, ${failed} failed.`);
  if (failed) process.exit(1);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** POST to GAS, retrying past Google's occasional HTML interstitial —
 *  same shape as proj0183-drive-orphans.mjs's gas() helper. Returns null
 *  (never throws) on a reply that is never JSON, so a caller can tell
 *  "the file really failed to move" from "GAS never answered". */
async function postToGas(url, payload, { tries = 3, timeoutMs = 30000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
      });
      const t = await r.text();
      if (t.trim().startsWith('{')) return JSON.parse(t);
    } catch { /* timeout or network — retry */ }
    await sleep(8000 * (i + 1));
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
