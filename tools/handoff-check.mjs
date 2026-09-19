#!/usr/bin/env node
// ============================================================
// handoff-check.mjs — is this session actually handed off?
//
// WHY IT EXISTS, in the owner's words: *"you should also have workflow to
// verify and doing this so that i don't have to tell you like this everytime at
// the end. when you do it, you often missed some handoff."*
//
// Correct, and the fix is not another paragraph in CLAUDE.md telling the next
// agent to be careful. This repo's own rule: **prefer a guard over a
// paragraph** — writing a hazard down has never once made anyone check it. So
// the end-of-turn loop gets a command that either passes or names what is
// missing.
//
// ⛔ WHAT IT DOES NOT DO. It cannot tell whether a sentence is TRUE. It checks
// the things that are mechanically checkable and says so plainly; a green run
// means "nothing checkable is wrong", never "the handoff is good". The
// judgement is still a person's.
//
// ⛔ AND IT NEVER PASSES BY BEING UNABLE TO LOOK. Every check that needs the
// network, the VPN or a credential reports SKIP with the reason and makes the
// whole run non-green. A check that silently succeeds when it could not run is
// the failure mode this repo has paid for most (`.claude/rules/mistakes.md`
// class 7) — including once in this very file's subject matter, where a guard
// was green on CI for the exact state it existed to catch.
//
//   npm run handoff:check          # everything it can reach
//   npm run handoff:check -- --local   # skip VM/DB/CI, for offline work
// ============================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_ONLY = process.argv.includes('--local');

const results = [];
const ok = (name, detail = '') => results.push({ s: 'ok', name, detail });
const bad = (name, detail) => results.push({ s: 'bad', name, detail });
const skip = (name, detail) => results.push({ s: 'skip', name, detail });

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MEM = join(homedir(), '.claude/projects',
  ROOT.replace(/\/$/, '').replace(/\//g, '-'), 'memory');

// ── 1. nothing left on the floor ────────────────────────────────────────────
try {
  const dirty = git('status', '--porcelain');
  if (dirty) bad('working tree is clean', `${dirty.split('\n').length} uncommitted path(s):\n      ${dirty.split('\n').slice(0, 6).join('\n      ')}`);
  else ok('working tree is clean');
} catch (e) { skip('working tree is clean', e.message); }

try {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const ahead = git('rev-list', '--count', `origin/${branch}..HEAD`);
  if (ahead !== '0') bad('HEAD is pushed', `${ahead} commit(s) not on origin/${branch}`);
  else ok('HEAD is pushed', `origin/${branch}`);
} catch (e) { skip('HEAD is pushed', 'no origin ref — ' + e.message.split('\n')[0]); }

// ── 2. the memory index and the files agree ─────────────────────────────────
// Not style: a memory file with no index line is never READ, because the index
// is the only thing loaded at session start. It is present and invisible.
if (existsSync(MEM)) {
  const files = readdirSync(MEM).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  const index = readFileSync(join(MEM, 'MEMORY.md'), 'utf8');
  const orphans = files.filter((f) => !index.includes(`(${f})`));
  const linked = [...index.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)].map((m) => m[1]);
  const dead = linked.filter((l) => !existsSync(join(MEM, l)));
  if (orphans.length) bad('every memory file is in MEMORY.md', `not indexed, so never read: ${orphans.join(', ')}`);
  else ok('every memory file is in MEMORY.md', `${files.length} indexed + MEMORY.md`);
  if (dead.length) bad('every MEMORY.md link resolves', dead.join(', '));
  else ok('every MEMORY.md link resolves');

  const bads = [];
  for (const f of files) {
    const t = readFileSync(join(MEM, f), 'utf8');
    const name = (t.match(/^name:\s*(.+)$/m) || [])[1]?.trim();
    const type = (t.match(/^\s+type:\s*(.+)$/m) || [])[1]?.trim();
    const desc = (t.match(/^description:\s*(.+)$/m) || [])[1]?.trim();
    if (name !== f.replace(/\.md$/, '')) bads.push(`${f}: name is "${name}"`);
    if (!['user', 'feedback', 'project', 'reference'].includes(type)) bads.push(`${f}: type "${type}"`);
    if (!desc) bads.push(`${f}: no description`);
  }
  if (bads.length) bad('memory frontmatter is valid', bads.join('\n      '));
  else ok('memory frontmatter is valid');
  // ── every pointer a memory hands the next session must land ──────────────
  // A memory naming a file or a command that no longer exists is worse than no
  // memory: it is read as current, and the session spends its first minutes
  // chasing something that was renamed. Placeholders that were never meant to
  // resolve are named here, not pattern-matched away.
  const PLACEHOLDERS = new Set(['src/js/foo.js', 'x']);
  const all = files.map((f) => readFileSync(join(MEM, f), 'utf8')).join('\n');
  const pkg = read('package.json');
  const deadScripts = [...new Set([...all.matchAll(/npm run ([a-z][a-z:0-9-]*)/g)].map((m) => m[1]))]
    .filter((n) => !PLACEHOLDERS.has(n) && !pkg.includes(`"${n}"`));
  const deadPaths = [...new Set([...all.matchAll(/\b(?:src|tools|docs|server|skills|supabase|passport)\/[A-Za-z0-9_./-]+\.(?:js|mjs|md|sql|sh|gs)\b/g)].map((m) => m[0]))]
    .filter((f) => !PLACEHOLDERS.has(f) && !existsSync(join(ROOT, f)));
  if (deadScripts.length) bad('memories name only commands that exist', `npm run ${deadScripts.join(', npm run ')}`);
  else ok('memories name only commands that exist');
  if (deadPaths.length) bad('memories name only files that exist', deadPaths.join(', '));
  else ok('memories name only files that exist');
} else {
  bad('memory directory exists', `not at ${MEM}`);
}

// ── 3. the handoff documents ────────────────────────────────────────────────
try {
  const h = read('docs/state/HANDOFF.md');
  const secs = [...h.matchAll(/^## (\d+[a-z]?)\. (.+)$/gm)];
  // §0 is "How to read this file" — it explains what a Status line MEANS, so
  // requiring one of it is the guard misreading its own subject. Named here
  // rather than pattern-matched away, so the exemption is visible.
  const META = new Set(['0']);
  const noStatus = [];
  for (let i = 0; i < secs.length; i += 1) {
    const from = secs[i].index;
    const to = i + 1 < secs.length ? secs[i + 1].index : h.length;
    const body = h.slice(from, to);
    if (META.has(secs[i][1])) continue;
    if (!/^\s*(\*\*)?Status:/m.test(body) && !/✅\s*(CLOSED|BUILT|DECIDED|ANSWERED)/.test(body)) {
      noStatus.push(secs[i][1]);
    }
  }
  if (noStatus.length) bad('every HANDOFF section says how far to trust it', `no Status: in §${noStatus.join(', §')}`);
  else ok('every HANDOFF section says how far to trust it', `${secs.length} sections`);
} catch (e) { skip('HANDOFF sections', e.message); }

// ── has the handoff fallen behind the work? ────────────────────────────────
// ⛔ THE POINT OF THIS ONE: a handoff written at the END depends on somebody
// noticing that the end has arrived, and the owner said plainly that they
// sometimes notice at 92% of a session — too late to write anything properly.
// So "are we handed off?" has to be answerable AT ANY MOMENT, not only when
// someone declares the session over.
//
// This counts shipping commits since STATE.md last moved. It is a proxy and it
// says so: a refactor changes no state and should not force STATE.md to churn,
// which is why 1–4 is reported and tolerated. Past that, work the next session
// needs to know about is almost certainly sitting unrecorded, and the check
// names the commits so writing it up takes a minute rather than a re-read.
try {
  const last = git('log', '-1', '--format=%H', '--', 'STATE.md');
  const since = git('log', '--oneline', `${last}..HEAD`, '--',
    'src/', 'supabase/', 'server/', 'passport/', 'tools/', 'functions/');
  const n = since ? since.split('\n').length : 0;
  if (n >= 5) {
    bad('the handoff has kept up with the work',
      `${n} shipping commits since STATE.md last moved:\n      ${since.split('\n').slice(0, 6).join('\n      ')}`);
  } else if (n > 0) {
    ok('the handoff has kept up with the work', `${n} shipping commit(s) since STATE.md moved — fine unless one changed STATE`);
  } else {
    ok('the handoff has kept up with the work', 'STATE.md is current with the work');
  }
} catch (e) { skip('the handoff has kept up with the work', e.message.split('\n')[0]); }

try {
  const lines = read('STATE.md').split('\n').length;
  if (lines > 260) bad('STATE.md is still a status file', `${lines} lines, budget ~200 (hard stop 260)`);
  else ok('STATE.md is still a status file', `${lines} lines`);
} catch (e) { skip('STATE.md length', e.message); }

// ── 4. the numbers documents state, against the database ────────────────────
// PROSE IS AN IMPLEMENTATION TOO. A count written into a note is a copy of a
// fact whose home is the database, and it rots the moment the work continues —
// this check was written after `house-handover-sheets.md` was found still
// claiming 155 kkumail requests on the day the answer had made it 129.
//
// Each entry is explicit about what it re-derives. It is not a general
// staleness detector and does not pretend to be one: it catches THESE numbers,
// wherever a watched document states a different value for them.
const LIVE_FACTS = [
  { key: 'held_open', sql: 'select count(*) from public.student_import_unresolved where resolved_at is null',
    label: 'ค้างนำเข้า (held rows)', near: /(\d+)\s*(?:คน)?\s*(?:rows?\s*)?(?:want|ask|รอ|ค้างนำเข้า|held)/gi },
  { key: 'advisors', sql: 'select count(*) from public.advisors', label: 'advisors' },
  { key: 'students', sql: 'select count(*) from public.students', label: 'students' },
];
if (LOCAL_ONLY) {
  skip('documented counts match the database', '--local');
} else {
  try {
    const sql = LIVE_FACTS.map((f) => `select '${f.key}' as k, (${f.sql})::text as v`).join(' union all ');
    const out = execFileSync('node', ['tools/db-query.mjs', '/dev/stdin'],
      { cwd: ROOT, input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const rows = JSON.parse(out.slice(out.indexOf('[')));
    const live = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    ok('read the live counts', Object.entries(live).map(([k, v]) => `${k}=${v}`).join(' · '));

    // The watched documents: the ones a cold session reads first.
    const watched = ['STATE.md', 'docs/state/HANDOFF.md'];
    for (const f of readdirSync(MEM).filter((x) => x.endsWith('.md'))) watched.push(`MEM:${f}`);
    const stale = [];
    for (const w of watched) {
      const text = w.startsWith('MEM:') ? readFileSync(join(MEM, w.slice(4)), 'utf8') : read(w);
      // Only the held count is phrased consistently enough to match on. Adding
      // a fact here means adding its phrasing too — deliberately, so this never
      // becomes a regex guessing at prose.
      for (const m of text.matchAll(/(\d{2,4})\s*(?:rows?\s*)?(?:want|ask for)\s*(?:a\s*)?kkumail/gi)) {
        if (m[1] !== live.held_open) stale.push(`${w}: "${m[0].trim()}" — live is ${live.held_open}`);
      }
    }
    if (stale.length) bad('documented counts match the database', stale.join('\n      '));
    else ok('documented counts match the database', `kkumail asks = ${live.held_open}`);
  } catch (e) {
    skip('documented counts match the database', (e.message || '').split('\n')[0]);
  }
}

// ── 5. production, and the memory the night agent reads ─────────────────────
if (LOCAL_ONLY) {
  skip('production serves the documented sha', '--local');
  skip('the VM memory matches this laptop', '--local');
} else {
  const r = spawnSync('node', ['tools/deploy-owed.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  if (/NO DEPLOY OWED/.test(text)) ok('production serves the documented sha');
  else if (/A DEPLOY IS OWED/.test(text)) bad('production serves the documented sha', 'run skills/deploy-vm.md');
  else skip('production serves the documented sha', 'could not reach production (VPN?)');

  const vm = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'samo-vm',
    'ls ~/samo-night/memory 2>/dev/null | wc -l'], { encoding: 'utf8' });
  if (vm.status !== 0) {
    skip('the VM memory matches this laptop', 'VM unreachable (VPN?)');
  } else {
    // Counted the SAME WAY on both sides, including MEMORY.md. The first
    // version counted the index out on one side and in on the other, and
    // reported "54 files" and "55 files" about an identical directory.
    const there = Number((vm.stdout || '0').trim());
    const here = existsSync(MEM) ? readdirSync(MEM).filter((f) => f.endsWith('.md')).length : 0;
    if (there !== here) bad('the VM memory matches this laptop', `VM has ${there}, laptop has ${here} — run bash server/night-agent/install.sh`);
    else ok('the VM memory matches this laptop', `${here} files`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const mark = { ok: '✓', bad: '✗', skip: '–' };
console.log('');
for (const r of results) {
  console.log(`  ${mark[r.s]} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
}
const bads = results.filter((r) => r.s === 'bad').length;
const skips = results.filter((r) => r.s === 'skip').length;
console.log('');
if (bads) {
  console.log(`  ⛔ ${bads} ไม่ผ่าน${skips ? ` · ${skips} ตรวจไม่ได้` : ''} — ยังส่งมอบไม่ครบ\n`);
} else if (skips) {
  // Not green. "I could not look" is not "it is fine".
  console.log(`  ⚠️  ผ่านเท่าที่ตรวจได้ แต่ ${skips} รายการตรวจไม่ได้ — ยังไม่ถือว่าเขียว\n`);
} else {
  console.log('  ✅ ทุกอย่างที่ตรวจได้ผ่านหมด (ไม่ได้แปลว่าเนื้อหาถูก — คนยังต้องอ่าน)\n');
}
process.exit(bads ? 1 : 0);
